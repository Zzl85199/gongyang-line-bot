// lib/supabase.js
// 伺服器端使用 service_role key（只在後端，不會外洩到前端）。
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[supabase] 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，DB 功能會失效');
}

export const supa = createClient(url || 'http://localhost', key || 'anon', {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const PHOTO_BUCKET = 'lifebook';
