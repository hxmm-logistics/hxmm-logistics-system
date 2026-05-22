import { query } from '../db.js';

function yyyymmdd(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export async function generateTrackingNo() {
  const datePart = yyyymmdd();
  const prefix = `HX${datePart}`;
  const result = await query(
    "SELECT nextval('platform_tracking_no_seq')::bigint AS serial"
  );
  const serial = String(result.rows[0].serial).padStart(4, '0');
  return `${prefix}${serial}`;
}
