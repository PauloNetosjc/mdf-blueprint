import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key);
const { data, error } = await sb.storage.from('pecas-cadastradas').download('166c4e6f-9b15-4733-a91a-41b41a2ac631/BAS0485A.pdf');
if (error) { console.error(error); process.exit(1); }
const buf = Buffer.from(await data.arrayBuffer());
const fs = await import('fs');
fs.writeFileSync('/tmp/bas/BAS0485A.pdf', buf);
console.log('saved', buf.length);
