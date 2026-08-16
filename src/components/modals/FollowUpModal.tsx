'use client';

import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { IconWa } from '../icons';
import { STATUS_META } from '@/lib/constants';
import { normalizePhone, num } from '@/lib/format';
import { api } from '@/lib/api-client';
import { useDataStore } from '@/store/useDataStore';
import { useUiStore } from '@/store/useUiStore';
import type { Customer, Prospect } from '@/lib/types';

function buildProspectMessage(r: Prospect, senderName: string): string {
  const stMeta = STATUS_META[num(r.status)] || STATUS_META[0];
  return `Selamat siang Bapak/Ibu ${r.customer},\n\nKami dari PT Tira Austenite (Steel Division) ingin follow up terkait penawaran berikut:\n- Produk: ${r.uraian || '-'}\n- Qty: ${num(r.qty)} pcs\n- Status saat ini: ${stMeta.label}\n\nMohon info perkembangan / kepastian order dari Bapak/Ibu. Terima kasih.\n\nSalam,\n${senderName}`;
}
function buildCustomerMessage(c: Customer, senderName: string): string {
  return `Selamat siang Bapak/Ibu ${c.pic || c.name},\n\nKami dari PT Tira Austenite (Steel Division) ingin menyapa dan menginformasikan ketersediaan produk baja terbaru kami untuk kebutuhan ${c.name}.\n\nMohon informasi apabila ada kebutuhan yang dapat kami bantu. Terima kasih.\n\nSalam,\n${senderName}`;
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
    } else {
      const c = customers.find((x) => x.id === ctx.id);
      if (!c) return;
      setPhone(c.phone || '');
      setMessage(buildCustomerMessage(c, senderName));
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
      </div>
    </Modal>
  );
}
