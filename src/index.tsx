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
import { LibraryContextMenu, patchGameContextMenu } from './patches/gameContextMenu';

// ─── Sidebar panel ────────────────────────────────────────────────────────────
function Content() {
  const openManage = () => {
    pageState.initialPage = 'manage';
    pageState.appId = null;
    pageState.appName = '';
    dispatchNavigate({ tab: 'manage', appId: null, appName: '' });
    Router.CloseSideMenus();
    Router.Navigate('/proton-pulse');
  };

  return (
    <PanelSection>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={openManage}
          description="View and manage ProtonDB configurations"
        >
          Manage Configurations
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
