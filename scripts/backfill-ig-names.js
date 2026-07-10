#!/usr/bin/env node
// Backfill de conversations.display_name para las conversaciones de Instagram
// existentes, consultando el username/nombre en la Graph API.
//
// Uso: IG_ACCESS_TOKEN=<token> node scripts/backfill-ig-names.js
// (SUPABASE_URL y SUPABASE_SERVICE_KEY se leen del .env del proyecto)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY || !IG_TOKEN) {
  console.error('Faltan SUPABASE_URL, SUPABASE_SERVICE_KEY o IG_ACCESS_TOKEN');
  process.exit(1);
}

const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/conversations?channel=eq.instagram&display_name=is.null&select=user_id&order=last_message_at.desc&limit=1000`,
    { headers: SB_HEADERS },
  );
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  const convs = await r.json();
  console.log(`${convs.length} conversaciones IG sin display_name`);

  let ok = 0, sinPerfil = 0, errores = 0;
  for (const { user_id } of convs) {
    try {
      const pr = await fetch(
        `https://graph.instagram.com/v21.0/${user_id}?fields=username,name`,
        { headers: { Authorization: `Bearer ${IG_TOKEN}` } },
      );
      const data = await pr.json().catch(() => ({}));
      if (!pr.ok || data.error || !data.username) {
        sinPerfil++;
        console.log(`  ${user_id}: sin perfil (${(data.error && data.error.message) || pr.status})`);
      } else {
        const name = data.name ? `${data.name} (@${data.username})` : `@${data.username}`;
        const ur = await fetch(
          `${SUPABASE_URL}/rest/v1/conversations?user_id=eq.${encodeURIComponent(user_id)}`,
          {
            method: 'PATCH',
            headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
            body: JSON.stringify({ display_name: name }),
          },
        );
        if (!ur.ok) throw new Error(`PATCH ${ur.status}: ${await ur.text()}`);
        ok++;
        console.log(`  ${user_id}: ${name}`);
      }
    } catch (err) {
      errores++;
      console.warn(`  ${user_id}: ERROR ${err.message}`);
    }
    await sleep(150);
  }
  console.log(`\nListo: ${ok} actualizadas, ${sinPerfil} sin perfil, ${errores} errores.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
