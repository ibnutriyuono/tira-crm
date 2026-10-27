'use client';

import { isPurchasingRoleClient } from '@/lib/doc-lines';
import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { TopBar } from './TopBar';
import { KpiGrid } from './KpiGrid';
import { FunnelPanel } from './FunnelPanel';
import { Filters } from './Filters';
import { ProspectTable } from './ProspectTable';
import { KanbanBoard } from './KanbanBoard';
import { ToastHost } from './ToastHost';
import { TeamChatWidget } from './TeamChatWidget';
import { ProspectFormModal } from './modals/ProspectFormModal';
import { QcdModal } from './modals/QcdModal';
import { FollowUpModal } from './modals/FollowUpModal';
import { DeleteConfirmModal } from './modals/DeleteConfirmModal';
import { QuotationModal } from './modals/QuotationModal';
import { MailComposeModal } from './modals/MailComposeModal';
import { VisitTasksModal } from './modals/VisitTasksModal';
import { RfqModal } from './modals/RfqModal';
import { RfqManageModal } from './modals/RfqManageModal';
import { UsersModal } from './modals/UsersModal';
import { UserFormModal } from './modals/UserFormModal';
import { CustomersModal } from './modals/CustomersModal';
import { CustomerUnifyModal } from './modals/CustomerUnifyModal';
import { VendorsModal } from './modals/VendorsModal';
import { VendorFormModal } from './modals/VendorFormModal';
import { FupaModal } from './modals/FupaModal';
import { FupaManageModal } from './modals/FupaManageModal';
import { PurchasingMonitorModal } from './modals/PurchasingMonitorModal';
import { CustomerIntelModal } from './modals/CustomerIntelModal';
import { CustomerProfileModal } from './modals/CustomerProfileModal';
import { KeyAccountModal } from './modals/KeyAccountModal';
import { PipelineIssuesModal } from './modals/PipelineIssuesModal';
import { AdminQueueModal } from './modals/AdminQueueModal';
import { OpsRulesModal } from './modals/OpsRulesModal';
import { MobileShell } from './mobile/MobileShell';
import { isSmallScreen, setPhonePref, usePhoneMode } from '@/hooks/usePhoneMode';
import { LeadDeskModal } from './leaddesk/LeadDeskModal';
import { RolesModal } from './modals/RolesModal';
import { MarketingModal } from './modals/MarketingModal';
import { CancelDocModal } from './modals/CancelDocModal';
import { SalesPlanModal } from './modals/SalesPlanModal';
import { NotificationsModal } from './modals/NotificationsModal';
import { FollowUpBoardModal } from './modals/FollowUpBoardModal';
import { GmAnalysisModal } from './modals/GmAnalysisModal';
import { ItemFlowModal } from './modals/ItemFlowModal';
import { KpiModal } from './modals/KpiModal';
import { CompetitorLogModal } from './modals/CompetitorLogModal';
import { ForecastModal } from './modals/ForecastModal';
import { QcdRecapModal } from './modals/QcdRecapModal';
import { CustomerFormModal } from './modals/CustomerFormModal';
import { ImportModal } from './modals/ImportModal';
import { DatabaseModal } from './modals/DatabaseModal';
import { DbImportConfirmModal } from './modals/DbImportConfirmModal';
import { ActivityLogModal } from './modals/ActivityLogModal';
import { SalesActivityModal } from './modals/SalesActivityModal';
import { ActivityKpiModal } from './modals/ActivityKpiModal';
import { VisitTripModal } from './modals/VisitTripModal';
import { AccountModal } from './modals/AccountModal';
import { RunningText } from './RunningText';
import { getFilteredProspects, sortProspects } from '@/lib/filter';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useCrmSocket } from '@/hooks/useCrmSocket';
import { useNotifDeepLink } from '@/hooks/useNotifDeepLink';

import { useT } from '@/store/useLangStore';
export function CrmApp() {
  const tr = useT();
  const loaded = useDataStore((s) => s.loaded);
  const bootstrap = useDataStore((s) => s.bootstrap);
  const records = useDataStore((s) => s.prospects);
  const currentUser = useDataStore((s) => s.currentUser);
  const router = useRouter();
  const ui = useUiStore();
  const hydrateViewState = useUiStore((s) => s.hydrateViewState);

  useCrmSocket();
  useNotifDeepLink(!isPurchasingRoleClient(currentUser?.role));

  useEffect(() => {
    hydrateViewState();
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Purchasing works a different job to Sales, so it lands on the purchasing
  // workspace rather than the prospect pipeline (matches the single-file app).
  useEffect(() => {
    // Gate on `loaded` so the redirect can never fire on a role left over from
    // a previous session before bootstrap() has replaced it.
    if (loaded && isPurchasingRoleClient(currentUser?.role)) router.replace('/purchasing' + window.location.search);
  }, [loaded, currentUser?.role, router]);

  // VP: Beranda Pimpinan terbuka sekali per sesi browser saat CRM pertama dibuka.
  useEffect(() => {
    if (!loaded || currentUser?.role !== 'vp' || window.location.search.includes('n=')) return;
    try {
      if (sessionStorage.getItem('tira.leadDesk.shown')) return;
      sessionStorage.setItem('tira.leadDesk.shown', '1');
    } catch {
      /* tanpa sessionStorage: tetap buka */
    }
    useUiStore.getState().openModal('leadDesk');
  }, [loaded, currentUser?.role]);

  // Mode HP (web responsif): layar kecil → MobileShell; Purchasing punya halaman sendiri.
  const phoneView = usePhoneMode();
  const phone = phoneView && !isPurchasingRoleClient(currentUser?.role);
  const smallScreen = !phoneView && isSmallScreen();

  // Deliberately depends on the individual filter/sort fields rather than `ui`
  // as a whole — `ui` also carries page/viewMode/modal state that shouldn't
  // invalidate this list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => sortProspects(getFilteredProspects(records, ui), ui.sortKey, ui.sortDir), [records, ui.search, ui.fReg, ui.fCabang, ui.fSe, ui.fKlas, ui.fStatus, ui.fPenawaran, ui.fBulan, ui.fTahun, ui.fDibuat, ui.sortKey, ui.sortDir]);

  if (!loaded) {
    return (
      <div>
        <div className="app-loading">{tr("Memuat data CRM…")}</div>
      </div>
    );
  }

  return (
    <>
      {phone ? (
        <MobileShell />
      ) : (
      <>
      {smallScreen && (
        <button type="button" className="mb-back-hp" onClick={() => setPhonePref('auto')}>
          📱 {tr("Tampilan HP")}
        </button>
      )}
      <TopBar />
      <RunningText />
      <div className="wrap">
        <KpiGrid list={filtered} />
        <FunnelPanel list={filtered} />
        <div className="panel">
          <div className="panel-head">
            <h2>{tr("Daftar Prospek")}</h2>
            <div className="panel-head-right">
              <span className="hint">
                {filtered.length} {tr("dari")} {records.length} {tr("total prospek")}{ui.viewMode === 'card' ? tr(" (tampilan card — geser kartu antar kolom untuk ubah status)") : ''}
              </span>
              <div className="view-toggle">
                <button type="button" className={ui.viewMode === 'table' ? 'active' : ''} onClick={() => useUiStore.setState({ viewMode: 'table' })}>
                  {tr("Tabel")}
                </button>
                <button type="button" className={ui.viewMode === 'card' ? 'active' : ''} onClick={() => useUiStore.setState({ viewMode: 'card' })}>
                  {tr("Card")}
                </button>
              </div>
            </div>
          </div>
          <Filters />
          {ui.viewMode === 'card' ? <KanbanBoard filtered={filtered} /> : <ProspectTable filtered={filtered} total={records.length} />}
        </div>
      </div>
      </>
      )}

      <ProspectFormModal />
      <ImportModal />
      <DeleteConfirmModal />
      <FollowUpModal />
      <UsersModal />
      <UserFormModal />
      <CustomersModal />
      <CustomerUnifyModal />
      <CustomerFormModal />
      <VendorsModal />
      <VendorFormModal />
      <FupaModal />
      <FupaManageModal />
      <PurchasingMonitorModal />
      <CustomerIntelModal />
      <CustomerProfileModal />
      <KeyAccountModal />
      <PipelineIssuesModal />
      <AdminQueueModal />
      <RolesModal />
      <OpsRulesModal />
      <LeadDeskModal />
      <MarketingModal />
      <CancelDocModal />
      <SalesPlanModal />
      <NotificationsModal />
      <FollowUpBoardModal />
      <GmAnalysisModal />
      <ItemFlowModal />
      <KpiModal />
      <SalesActivityModal />
      <ActivityKpiModal />
      <VisitTripModal />
      <CompetitorLogModal />
      <ForecastModal />
      <QcdRecapModal />
      <DatabaseModal />
      <DbImportConfirmModal />
      <RfqManageModal />
      <RfqModal />
      <QcdModal />
      <QuotationModal />
      <MailComposeModal />
      <VisitTasksModal />
      <ActivityLogModal />
      <AccountModal />
      <ToastHost />
      <TeamChatWidget />
    </>
  );
}
