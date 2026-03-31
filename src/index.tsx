// src/index.tsx
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  staticClasses,
  Router,
} from '@decky/ui';
import {
  definePlugin,
  routerHook,
} from '@decky/api';
import { FaBolt } from 'react-icons/fa';

import { ProtonPulsePage } from './components/Modal';
import { pageState, dispatchNavigate } from './lib/pageState';
import type { PageId } from './lib/pageState';
import { LibraryContextMenu, patchGameContextMenu } from './patches/gameContextMenu';

// ─── Sidebar panel ────────────────────────────────────────────────────────────
function Content() {
  const navigateTo = (tab: PageId) => {
    pageState.initialPage = tab;
    pageState.appId = null;
    pageState.appName = '';
    dispatchNavigate({ tab, appId: null, appName: '' });
    Router.CloseSideMenus();
    Router.Navigate('/proton-pulse');
  };

  return (
    <PanelSection>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() => navigateTo('logs')}
          description="View plugin activity log"
        >
          Logs
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() => navigateTo('settings')}
          description="Debug mode and display options"
        >
          Settings
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

// ─── Plugin definition ────────────────────────────────────────────────────────
export default definePlugin(() => {
  console.log('Proton Pulse initializing');

  routerHook.addRoute('/proton-pulse', ProtonPulsePage);
  const menuPatch = patchGameContextMenu(LibraryContextMenu);

  return {
    name: 'Proton Pulse',
    titleView: <div className={staticClasses.Title}>Proton Pulse</div>,
    content: <Content />,
    icon: <FaBolt />,
    onDismount() {
      console.log('Proton Pulse unloading');
      routerHook.removeRoute('/proton-pulse');
      menuPatch.unpatch();
    },
  };
});
