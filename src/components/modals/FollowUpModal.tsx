'use client';

import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { IconWa } from '../icons';
import { STATUS_META } from '@/lib/constants';
import { getPrimaryPic, normalizePhone, num } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Customer, Prospect } from '@/lib/types';

function buildProspectMessage(r: Prospect, senderName: string): string {
  const stMeta = STATUS_META[num(r.status)] || STATUS_META[0];
  return `Selamat siang Bapak/Ibu ${r.customer},\n\nKami dari PT Tira Austenite (Steel Division) ingin follow up terkait penawaran berikut:\n- Produk: ${r.uraian || '-'}\n- Qty: ${num(r.qty)} pcs\n- Status saat ini: ${stMeta.label}\n\nMohon info perkembangan / kepastian order dari Bapak/Ibu. Terima kasih.\n\nSalam,\n${senderName}`;
}
function buildCustomerMessage(c: Customer, senderName: string): string {
  const picName = getPrimaryPic(c)?.nama || c.name;
  return `Selamat siang Bapak/Ibu ${picName},\n\nKami dari PT Tira Austenite (Steel Division) ingin menyapa dan menginformasikan ketersediaan produk baja terbaru kami untuk kebutuhan ${c.name}.\n\nMohon informasi apabila ada kebutuhan yang dapat kami bantu. Terima kasih.\n\nSalam,\n${senderName}`;
}

export function FollowUpModal() {
  const modal = useUiStore((s) => s.modal);
  const show = modal === 'followUp';
  const ctx = useUiStore((s) => s.followUpCtx);
  const closeModal = useUiStore((s) => s.closeModal);

  const currentUser = useDataStore((s) => s.currentUser);
  const records = useDataStore((s) => s.prospects);
  const customers = useDataStore((s) => s.customers);
  const upsertProspect = useDataStore((s) => s.upsertProspect);
  const upsertCustomer = useDataStore((s) => s.upsertCustomer);
  const toast = useDataStore((s) => s.toast);

  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [nextNote, setNextNote] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);

  useEffect(() => {
    if (!show || !ctx) return;
    const senderName = currentUser?.name || 'Tim Sales';
    if (ctx.type === 'prospect') {
      const r = records.find((x) => x.id === ctx.id);
      if (!r) return;
      let p = r.phone || '';
      if (!p) {
        const match = customers.find((c) => (c.name || '').trim().toLowerCase() === (r.customer || '').trim().toLowerCase());
        if (match) p = match.phone || '';
      }
      setPhone(p);
      setMessage(buildProspectMessage(r, senderName));
      // Prefills whatever's already scheduled, so reopening this modal shows
      // (and lets you adjust) the existing plan rather than a blank slate.
      setNextDate(r.followUpAt || '');
      setNextNote(r.followUpNote || '');
    } else {
      const c = customers.find((x) => x.id === ctx.id);
      if (!c) return;
      setPhone(c.phone || '');
      setMessage(buildCustomerMessage(c, senderName));
      setNextDate('');
      setNextNote('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, ctx]);

  if (!ctx) return null;

  async function onSend() {
    const normalized = normalizePhone(phone);
    if (normalized.length < 9) {
      toast('Nomor WhatsApp tidak valid. Isi nomor yang benar (cth. 08123456789).', 'error');
      return;
    }
    try {
      if (ctx!.type === 'prospect') {
        const r = records.find((x) => x.id === ctx!.id);
        if (r && phone.trim() !== (r.phone || '')) {
          const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${ctx!.id}`, { phone: phone.trim() });
          upsertProspect(prospect);
        }
      } else {
        const c = customers.find((x) => x.id === ctx!.id);
        if (c && phone.trim() !== (c.phone || '')) {
          const { customer } = await api.patch<{ customer: Customer }>(`/api/customers/${ctx!.id}`, { phone: phone.trim() });
          upsertCustomer(customer);
        }
      }
    } catch {
      // non-blocking — still open WhatsApp even if the phone-number save failed
    }
    window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(message)}`, '_blank');
    closeModal();
  }

  // Independent of onSend — scheduling the next follow-up and sending
  // today's WhatsApp message are two separate decisions, someone might only
  // want one of them (e.g. schedule now, send the message later manually).
  async function onSaveSchedule() {
    if (!ctx || ctx.type !== 'prospect') return;
    setSavingSchedule(true);
    try {
      const { prospect } = await api.patch<{ prospect: Prospect }>(`/api/prospects/${ctx.id}`, {
        followUpAt: nextDate || null,
        followUpNote: nextNote.trim() || null,
      });
      upsertProspect(prospect);
      toast(nextDate ? `Follow-up berikutnya dijadwalkan ${nextDate}` : 'Jadwal follow-up dihapus', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Gagal menyimpan jadwal', 'error');
    } finally {
      setSavingSchedule(false);
    }
  }

  return (
    <Modal
      show={show}
      onClose={closeModal}
      title="Follow Up via WhatsApp"
      wide
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={closeModal}>
            Batal
          </button>
          <button type="button" className="btn btn-wa" onClick={onSend}>
            <IconWa /> Buka WhatsApp
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="full">
          <label>Nomor WhatsApp</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="cth. 08123456789" />
        </div>
        <div className="full">
          <label>Pesan</label>
          <textarea style={{ minHeight: 170 }} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        {ctx.type === 'prospect' && (
          <>
            <div>
              <label>Jadwalkan Follow-up Berikutnya</label>
              <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            </div>
            <div>
              <label>Catatan (opsional)</label>
              <input type="text" value={nextNote} onChange={(e) => setNextNote(e.target.value)} placeholder="cth. Tanyakan kepastian PO" />
            </div>
            <div className="full">
              <button type="button" className="btn btn-outline btn-sm" disabled={savingSchedule} onClick={onSaveSchedule}>
                {nextDate ? 'Simpan Jadwal' : 'Hapus Jadwal'}
              </button>
              <div className="field-note" style={{ marginTop: 6 }}>
                Terpisah dari tombol &quot;Buka WhatsApp&quot; di bawah — bisa menjadwalkan saja tanpa mengirim pesan sekarang, atau sebaliknya.
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
