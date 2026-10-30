/* ════════════════════════════════════════════════════════════════════════
   config.js — o ÚNICO arquivo que você edita para ligar o app ao Supabase.

   Onde achar os dois valores (Supabase → seu projeto → Project Settings → API):
     • Project URL                     → SUPABASE_URL
     • anon / publishable key (pública) → SUPABASE_ANON_KEY

   Pode colocar a chave pública aqui e subir para o GitHub: ela foi feita para
   ficar no app. Quem protege os dados são as regras do banco (01_schema.sql).
   NUNCA cole aqui a chave "service_role" (essa é secreta).

   Ao subir uma versão nova do app para o GitHub, NÃO substitua este arquivo.
   ════════════════════════════════════════════════════════════════════════ */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://tgxfkeqrwahnieesnlyd.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_Jt2PgjEnd4mHCxOEuGaIMw_8E7erB6H'
};
