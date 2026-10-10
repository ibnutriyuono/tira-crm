-- PIC Line 05 (fabrikasi): sees and works only RFQ / FUP A with a Line 05 item.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'purchasing05';
