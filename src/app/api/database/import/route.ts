import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { isResponse, requireAdmin, requireUser } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { emitCrmEvent } from '@/lib/socket';
import type { Prisma } from '@prisma/client';
import type { Role } from '@/lib/types';

// Full destructive restore from a .json backup produced by /api/database/export.
// Admin-only, matches the original app's "Pulihkan Database dari Backup" flow.
export async function POST(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const adminErr = requireAdmin(user);
  if (adminErr) return adminErr;

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.prospects)) {
    return NextResponse.json({ error: 'File backup tidak valid: format tidak dikenali.' }, { status: 400 });
  }

  const prospects = body.prospects as Array<Record<string, unknown>>;
  const customers = Array.isArray(body.customers) ? (body.customers as Array<Record<string, unknown>>) : [];
  const rfqs = Array.isArray(body.rfqs) ? (body.rfqs as Array<Record<string, unknown>>) : [];
  const users = Array.isArray(body.users) ? (body.users as Array<Record<string, unknown>>) : [];
  const salesPlans = Array.isArray(body.salesPlans) ? (body.salesPlans as Array<Record<string, unknown>>) : [];
  const notifications = Array.isArray(body.notifications) ? (body.notifications as Array<Record<string, unknown>>) : [];

  await prisma.$transaction(async (tx) => {
    await tx.prospect.deleteMany({});
    if (prospects.length > 0) {
      await tx.prospect.createMany({
        data: prospects.map((p) => ({
          id: String(p.id),
          reg: p.reg == null ? null : Number(p.reg),
          cabang: (p.cabang as string) ?? '',
          se: (p.se as string) ?? '',
          customer: (p.customer as string) ?? '',
          phone: (p.phone as string) ?? '',
          tglPenawaran: (p.tglPenawaran as string) ?? null,
          tglPO: (p.tglPO as string) ?? null,
          tglDelivery: (p.tglDelivery as string) ?? null,
          line: (p.line as string) ?? '',
          uraian: (p.uraian as string) ?? '',
          qty: Number(p.qty) || 0,
          value: Number(p.value) || 0,
          materials: (p.materials ?? []) as Prisma.InputJsonValue,
          kondisiStock: (p.kondisiStock as string) ?? '',
          keterangan: (p.keterangan as string) ?? '',
          status: Number(p.status) || 0,
          penawaranTerkirim: !!p.penawaranTerkirim,
          qcdQuality: (p.qcdQuality as string) ?? '',
          qcdCost: (p.qcdCost as string) ?? '',
          qcdDelivery: (p.qcdDelivery as string) ?? '',
          qcdKompetitor: (p.qcdKompetitor as string) ?? '',
          qcdCatatan: (p.qcdCatatan as string) ?? '',
        })),
      });
    }

    await tx.customer.deleteMany({});
    if (customers.length > 0) {
      await tx.customer.createMany({
        data: customers.map((c) => ({
          id: String(c.id),
          name: (c.name as string) ?? '',
          cabang: (c.cabang as string) ?? '',
          pic: (c.pic as string) ?? '',
          phone: (c.phone as string) ?? '',
          email: (c.email as string) ?? '',
          address: (c.address as string) ?? '',
          catatan: (c.catatan as string) ?? '',
          // Multi-PIC list; backups taken before it existed have none.
          pics: (Array.isArray(c.pics) ? c.pics : []) as unknown as Prisma.InputJsonValue,
        })),
      });
    }

    await tx.rfq.deleteMany({});
    if (rfqs.length > 0) {
      await tx.rfq.createMany({
        data: rfqs.map((r) => ({
          id: String(r.id),
          noRfq: (r.noRfq as string) ?? '',
          tglRfq: (r.tglRfq as string) ?? '',
          cabang: (r.cabang as string) ?? '',
          customer: (r.customer as string) ?? '',
          requestedBy: (r.requestedBy as string) ?? '',
          prospectId: (r.prospectId as string) ?? null,
          items: (r.items ?? []) as Prisma.InputJsonValue,
          status: (r.status as string) ?? 'Draft',
        })),
      });
    }

    if (users.length > 0) {
      await tx.user.deleteMany({});
      await tx.user.createMany({
        data: users.map((u) => ({
          id: String(u.id),
          username: String(u.username),
          name: (u.name as string) ?? '',
          role: (u.role as Role) ?? 'sales',
          se: (u.se as string) ?? '',
          cabang: (u.cabang as string) ?? '',
          reg: u.reg == null || u.reg === '' ? null : Number(u.reg),
          passwordHash: String(u.passwordHash),
        })),
      });
    }

    await tx.salesPlan.deleteMany({});
    if (salesPlans.length > 0) {
      await tx.salesPlan.createMany({
        data: salesPlans.map((p) => ({
          id: String(p.id),
          periode: (p.periode as string) ?? '',
          se: (p.se as string) ?? '',
          cabang: (p.cabang as string) ?? null,
          reg: p.reg == null ? null : Number(p.reg),
          items: (p.items ?? []) as Prisma.InputJsonValue,
          value: Number(p.value) || 0,
          requestedBy: (p.requestedBy as string) ?? null,
        })),
      });
    }

    // Unlike ActivityLog (an audit trail, deliberately untouched below),
    // Notification is personal inbox state — mutable, disposable, meant to
    // be marked read and eventually ignored — so it's fine to fold into the
    // normal restore cycle rather than treated as immutable history.
    await tx.notification.deleteMany({});
    if (notifications.length > 0) {
      await tx.notification.createMany({
        data: notifications.map((n) => ({
          id: String(n.id),
          userId: String(n.userId),
          type: String(n.type),
          entity: String(n.entity),
          entityId: String(n.entityId),
          title: (n.title as string) ?? '',
          message: (n.message as string) ?? '',
          readAt: n.readAt ? new Date(n.readAt as string) : null,
          createdAt: n.createdAt ? new Date(n.createdAt as string) : new Date(),
        })),
      });
    }
  });

  // ActivityLog is intentionally left untouched by the restore: an audit trail
  // that a restore can erase is not an audit trail. It has no FK to User, so
  // the user.deleteMany above doesn't cascade into it either.
  emitCrmEvent('database:restored', { at: new Date().toISOString() });
  await logActivity({
    user,
    action: 'restore',
    entity: 'database',
    summary: `Memulihkan database dari backup (${prospects.length} prospek, ${customers.length} customer, ${rfqs.length} RFQ, ${users.length} user, ${salesPlans.length} rencana penjualan, ${notifications.length} notifikasi)`,
  });
  return NextResponse.json({ ok: true });
}
