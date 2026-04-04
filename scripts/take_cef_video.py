#!/usr/bin/env python3
"""Record the Steam Deck gamescope PipeWire source into a local video file."""

from __future__ import annotations

import argparse
import shlex
import subprocess
import sys
import time
from pathlib import Path


def run(
    cmd: list[str],
    *,
    capture: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        check=check,
        text=True,
        capture_output=capture,
    )


def remote_quote(value: str) -> str:
    return shlex.quote(value)


def build_paths(output_dir: Path, filename_base: str) -> tuple[Path, Path, str]:
    timestamp = time.strftime("%Y-%m-%d_%H-%M-%S")
    stem = f"{filename_base}-{timestamp}" if filename_base else f"proton-pulse-video-{timestamp}"
    local_tmp_path = output_dir / f"{stem}.webm"
    local_path = output_dir / f"{stem}.mp4"
    remote_path = f"/tmp/{stem}.webm"
    return local_path, local_tmp_path, remote_path


def build_remote_pipeline(remote_path: str, fps: int) -> str:
    return " ".join(
        [
            "gst-launch-1.0",
            "-e",
            "pipewiresrc",
            "target-object=gamescope",
            "do-timestamp=true",
            "!",
            "videoconvert",
            "!",
            "videorate",
            "!",
            f"video/x-raw,framerate={fps}/1",
            "!",
            "vp8enc",
            "deadline=1",
            "cpu-used=8",
            "threads=4",
            "!",
            "webmmux",
            "streamable=true",
            "!",
            "filesink",
            f"location={remote_quote(remote_path)}",
        ]
    )


def start_remote_recording(
    ssh_target: str,
    remote_path: str,
    fps: int,
    duration: float | None,
) -> tuple[subprocess.Popen[bytes], str]:
    remote_command = build_remote_pipeline(remote_path, fps)
    log_path = f"{remote_path}.log"
    if duration is None:
        stop_logic = "read -r _"
    else:
        stop_logic = f"sleep {max(duration, 0):.3f}"
    wrapper = (
        f"rm -f {remote_quote(remote_path)} {remote_quote(log_path)}; "
        f"({remote_command}) >{remote_quote(log_path)} 2>&1 & "
        "pid=$!; "
        f"{stop_logic}; "
        "kill -TERM $pid 2>/dev/null || true; "
        "wait $pid || true; "
        f"cat {remote_quote(log_path)} 2>/dev/null || true"
    )
    proc = subprocess.Popen(
        [
            "ssh",
            ssh_target,
            f"bash -lc {remote_quote(wrapper)}",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    return proc, log_path


def stop_remote_recording(proc: subprocess.Popen[bytes], *, manual_stop: bool) -> str:
    try:
        output = proc.communicate(input=b"\n" if manual_stop else None, timeout=30)[0]
    except subprocess.TimeoutExpired:
        proc.terminate()
        try:
            output = proc.communicate(timeout=10)[0]
        except subprocess.TimeoutExpired:
            proc.kill()
            output = proc.communicate(timeout=10)[0]
    return output.decode(errors="replace").strip()


def poll_remote_size(ssh_target: str, remote_path: str) -> int:
    result = run(
        ["ssh", ssh_target, f"bash -lc {remote_quote(f'stat -c %s {remote_quote(remote_path)} 2>/dev/null || echo 0')}"],
        capture=True,
        check=False,
    )
    try:
        return int((result.stdout or "0").strip() or "0")
    except ValueError:
        return 0


def rsync_remote_video(ssh_target: str, remote_path: str, local_path: Path) -> None:
    run(["rsync", "-av", f"{ssh_target}:{remote_path}", str(local_path)])
    run(["ssh", ssh_target, "rm", "-f", remote_path])


def convert_webm_to_mp4(source_path: Path, output_path: Path) -> None:
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(source_path),
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    )


def open_tty_for_stop() -> object | None:
    try:
        return open("/dev/tty", "r", encoding="utf-8", errors="ignore")
    except OSError:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Record the Deck's gamescope PipeWire video source into a local MP4 file."
    )
    parser.add_argument("--deck-ip", required=True, help="Steam Deck IP address")
    parser.add_argument("--deck-user", default="deck", help="SSH user for the Steam Deck")
    parser.add_argument("--output-dir", default="../videos", help="Local directory for saved videos")
    parser.add_argument("--filename-base", default="", help="Optional filename base")
    parser.add_argument("--fps", type=int, default=15, help="Target recording framerate")
    parser.add_argument("--duration", type=float, default=None, help="Optional auto-stop duration in seconds")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    local_path, local_tmp_path, remote_path = build_paths(output_dir, args.filename_base)
    ssh_target = f"{args.deck_user}@{args.deck_ip}"

    print(f"Recording Steam UI to: {local_path}")
    if args.duration is None:
        print("Press Enter to stop and process the video cleanly.")
        print("Ctrl+C may interrupt make before the video finalizes.")
    else:
        print(f"Recording for {args.duration:.1f}s before auto-stopping.")

    proc, log_path = start_remote_recording(ssh_target, remote_path, args.fps, args.duration)
    started_at = time.monotonic()
    last_status_at = started_at
    tty_input = open_tty_for_stop() if args.duration is None else None

    try:
        while True:
            if proc.poll() is not None:
                break
            if args.duration is not None and time.monotonic() - started_at >= args.duration:
                break

            if args.duration is None and tty_input:
                if time.monotonic() - last_status_at >= 2.0:
                    size = poll_remote_size(ssh_target, remote_path)
                    elapsed = time.monotonic() - started_at
                    if size > 0:
                        print(f"Recording... {elapsed:.1f}s, {size / 1024:.1f} KiB written")
                    else:
                        print(f"Recording... {elapsed:.1f}s, waiting for first bytes")
                    last_status_at = time.monotonic()

                import select
                ready, _, _ = select.select([tty_input], [], [], 0.25)
                if ready:
                    tty_input.readline()
                    break
            else:
                time.sleep(0.25)
    except KeyboardInterrupt:
        print("\nStopping recording...")
    finally:
        if tty_input:
            tty_input.close()

    remote_output = stop_remote_recording(proc, manual_stop=args.duration is None)
    if remote_output:
        print(remote_output)

    size = poll_remote_size(ssh_target, remote_path)
    if size <= 0:
        run(["ssh", ssh_target, "rm", "-f", remote_path, log_path], check=False)
        print("No video data was written, so no file was saved.", file=sys.stderr)
        return 1

    rsync_remote_video(ssh_target, remote_path, local_tmp_path)
    run(["ssh", ssh_target, "rm", "-f", log_path], check=False)
    convert_webm_to_mp4(local_tmp_path, local_path)
    local_tmp_path.unlink(missing_ok=True)
    print(f"Saved video locally to: {local_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
