-- Nilai enum baru untuk ActivityLog: Aktivitas Harian, target aktivitas, dan
-- Perjalanan Dinas. Tanpa ini setiap logActivity() dari fitur-fitur tersebut
-- ditolak Postgres ("invalid input value for enum"), karena kolom entity
-- memakai enum sungguhan, bukan TEXT bebas.
--
-- ADD VALUE tidak bisa dipakai di transaksi yang sama dengan pemakaiannya,
-- tapi migrasi ini hanya menambah nilai -- pemakaiannya baru di request
-- berikutnya, jadi aman. Pola yang sama sudah dipakai di phase0 dan phase20.
ALTER TYPE "ActivityEntity" ADD VALUE IF NOT EXISTS 'salesActivity';
ALTER TYPE "ActivityEntity" ADD VALUE IF NOT EXISTS 'activityTarget';
ALTER TYPE "ActivityEntity" ADD VALUE IF NOT EXISTS 'visitTrip';
