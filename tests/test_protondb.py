# tests/test_protondb.py
import asyncio
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from main import Plugin
import main as main_module


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def plugin(tmp_path):
    p = Plugin()
    original = main_module.LOG_FILE
    main_module.LOG_FILE = str(tmp_path / "test.log")
    p._setup_logger()
    yield p
    main_module.LOG_FILE = original


def test_fetch_summary_returns_dict_on_success(plugin):
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(return_value={"score": "gold", "tier": 3, "total": 42})
    mock_response.__aenter__ = AsyncMock(return_value=mock_response)
    mock_response.__aexit__ = AsyncMock(return_value=False)

    mock_session = MagicMock()
    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("aiohttp.ClientSession", return_value=mock_session):
        result = run(plugin.fetch_protondb_summary("2358720"))

    assert result["score"] == "gold"
    assert result["total"] == 42


def test_fetch_summary_returns_empty_on_404(plugin):
    mock_response = MagicMock()
    mock_response.status = 404
    mock_response.__aenter__ = AsyncMock(return_value=mock_response)
    mock_response.__aexit__ = AsyncMock(return_value=False)

    mock_session = MagicMock()
    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("aiohttp.ClientSession", return_value=mock_session):
        result = run(plugin.fetch_protondb_summary("0000000"))

    assert result == {}


def test_fetch_reports_returns_list_on_success(plugin):
    reports_data = [
        {"timestamp": 1700000000, "rating": "platinum", "protonVersion": "GE-Proton9-7",
         "notes": "Works great", "responses": {"gpu": "NVIDIA GeForce RTX 3080"}},
        {"timestamp": 1690000000, "rating": "gold", "protonVersion": "Proton 9.0",
         "notes": "Minor stutter", "responses": {"gpu": "AMD Radeon RX 7900 XTX"}},
    ]
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(return_value=reports_data)
    mock_response.__aenter__ = AsyncMock(return_value=mock_response)
    mock_response.__aexit__ = AsyncMock(return_value=False)

    mock_session = MagicMock()
    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("aiohttp.ClientSession", return_value=mock_session):
        result = run(plugin.fetch_protondb_reports("2358720"))

    assert len(result) == 2
    assert result[0]["rating"] == "platinum"


def test_fetch_reports_returns_empty_on_error(plugin):
    mock_session = MagicMock()
    mock_session.get = MagicMock(side_effect=Exception("network error"))
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("aiohttp.ClientSession", return_value=mock_session):
        result = run(plugin.fetch_protondb_reports("2358720"))

    assert result == []


def test_fetch_reports_uses_cache(plugin):
    plugin._reports_cache["123"] = [{"rating": "gold"}]
    result = run(plugin.fetch_protondb_reports("123"))
    assert result == [{"rating": "gold"}]
