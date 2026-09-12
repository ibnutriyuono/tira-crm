'use client';

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
import { RfqModal } from './modals/RfqModal';
import { RfqManageModal } from './modals/RfqManageModal';
import { UsersModal } from './modals/UsersModal';
import { UserFormModal } from './modals/UserFormModal';
import { CustomersModal } from './modals/CustomersModal';
import { VendorsModal } from './modals/VendorsModal';
import { VendorFormModal } from './modals/VendorFormModal';
import { FupaModal } from './modals/FupaModal';
import { FupaManageModal } from './modals/FupaManageModal';
import { PurchasingMonitorModal } from './modals/PurchasingMonitorModal';
import { CustomerIntelModal } from './modals/CustomerIntelModal';
import { MarketingModal } from './modals/MarketingModal';
import { CancelDocModal } from './modals/CancelDocModal';
import { SalesPlanModal } from './modals/SalesPlanModal';
import { NotificationsModal } from './modals/NotificationsModal';
import { CompetitorLogModal } from './modals/CompetitorLogModal';
import { ForecastModal } from './modals/ForecastModal';
import { QcdRecapModal } from './modals/QcdRecapModal';
import { CustomerFormModal } from './modals/CustomerFormModal';
import { ImportModal } from './modals/ImportModal';
import { DatabaseModal } from './modals/DatabaseModal';
import { DbImportConfirmModal } from './modals/DbImportConfirmModal';
import { ActivityLogModal } from './modals/ActivityLogModal';
import { getFilteredProspects, sortProspects } from '@/lib/filter';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import { useCrmSocket } from '@/hooks/useCrmSocket';

export function CrmApp() {
  const loaded = useDataStore((s) => s.loaded);
  const bootstrap = useDataStore((s) => s.bootstrap);
  const records = useDataStore((s) => s.prospects);
  const currentUser = useDataStore((s) => s.currentUser);
  const router = useRouter();
  const ui = useUiStore();
  const hydrateViewState = useUiStore((s) => s.hydrateViewState);

  useCrmSocket();

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
    if (loaded && currentUser?.role === 'purchasing') router.replace('/purchasing');
  }, [loaded, currentUser?.role, router]);

  // Deliberately depends on the individual filter/sort fields rather than `ui`
  // as a whole — `ui` also carries page/viewMode/modal state that shouldn't
  // invalidate this list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => sortProspects(getFilteredProspects(records, ui), ui.sortKey, ui.sortDir), [records, ui.search, ui.fReg, ui.fCabang, ui.fSe, ui.fKlas, ui.fStatus, ui.fPenawaran, ui.fBulan, ui.fTahun, ui.sortKey, ui.sortDir]);

  if (!loaded) {
    return (
      <div>
        <div className="app-loading">Memuat data CRM…</div>
      </div>
    );
  }

  return (
    <>
      <TopBar />
      <div className="wrap">
        <KpiGrid list={filtered} />
        <FunnelPanel list={filtered} />
        <div className="panel">
          <div className="panel-head">
            <h2>Daftar Prospek</h2>
            <div className="panel-head-right">
              <span className="hint">
                {filtered.length} dari {records.length} total prospek{ui.viewMode === 'card' ? ' (tampilan card — geser kartu antar kolom untuk ubah status)' : ''}
              </span>
              <div className="view-toggle">
                <button type="button" className={ui.viewMode === 'table' ? 'active' : ''} onClick={() => useUiStore.setState({ viewMode: 'table' })}>
                  Tabel
                </button>
                <button type="button" className={ui.viewMode === 'card' ? 'active' : ''} onClick={() => useUiStore.setState({ viewMode: 'card' })}>
                  Card
                </button>
              </div>
            </div>
          </div>
          <Filters />
          {ui.viewMode === 'card' ? <KanbanBoard filtered={filtered} /> : <ProspectTable filtered={filtered} total={records.length} />}
        </div>
      </div>

      <ProspectFormModal />
      <ImportModal />
      <DeleteConfirmModal />
      <FollowUpModal />
      <UsersModal />
      <UserFormModal />
      <CustomersModal />
      <CustomerFormModal />
      <VendorsModal />
      <VendorFormModal />
      <FupaModal />
      <FupaManageModal />
      <PurchasingMonitorModal />
      <CustomerIntelModal />
      <MarketingModal />
      <CancelDocModal />
      <SalesPlanModal />
      <NotificationsModal />
      <CompetitorLogModal />
      <ForecastModal />
      <QcdRecapModal />
      <DatabaseModal />
      <DbImportConfirmModal />
      <RfqManageModal />
      <RfqModal />
      <QcdModal />
      <QuotationModal />
      <ActivityLogModal />
      <ToastHost />
      <TeamChatWidget />
    </>
  );
}
