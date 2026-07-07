// app/app/[groupId]/settings/page.js
// 設定頁：人人都能進來看，但內容依角色不同——
//   主飼主（或開放模式下的任何人）：可以刪除整個照護圈（危險操作，需輸入確認文字）
//   照顧者 / 唯讀 / 對外授權（獸醫等）：只能「退出」這個照護圈，不影響其他人
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../../../lib/session.js';
import * as webdb from '../../../../lib/webdb.js';
import * as db from '../../../../lib/db.js';
import SettingsManager from './SettingsManager.jsx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function SettingsPage({ params }) {
  const groupId = decodeURIComponent(params.groupId);
  const user = await getSessionUser();
  const access = await webdb.effectiveAccess(groupId, user);
  if (!access) redirect('/app');

  const pets = await db.listAllPets(groupId);
  const confirmPhrase = pets.map((p) => p.name).join('、') || groupId;

  return (
    <SettingsManager
      groupId={groupId}
      isManager={webdb.canManage(access)}
      confirmPhrase={confirmPhrase}
      petsLabel={webdb.petsLabel(pets)}
    />
  );
}
