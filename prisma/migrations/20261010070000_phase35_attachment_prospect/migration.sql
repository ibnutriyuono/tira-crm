-- Gambar kerja Line 05 dilampirkan langsung di prospek.
ALTER TABLE "Attachment" ADD COLUMN "prospectId" TEXT;
CREATE INDEX "Attachment_prospectId_idx" ON "Attachment"("prospectId");
