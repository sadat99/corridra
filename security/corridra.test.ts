// These deliberately unsafe fixtures validate the scanner, not application behavior.
// ruleid: corridra-no-eval
eval('fixture');
// ruleid: corridra-no-eval
new Function('fixture');
// ok: corridra-no-eval
JSON.parse('{"fixture":true}');
// ruleid: corridra-no-insecure-tls
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// ruleid: corridra-no-insecure-tls
const unsafe = { rejectUnauthorized: false };
// ok: corridra-no-insecure-tls
const safe = { rejectUnauthorized: true };
// ruleid: corridra-no-environment-logging
console.log(process.env);
// ruleid: corridra-no-environment-logging
console.log(process.env.FIXTURE_KEY);
// ok: corridra-no-environment-logging
console.info({ event: 'safe_code', correlationId: 'synthetic' });
// ruleid: corridra-no-request-url-fetch
fetch(request.url);
// ruleid: corridra-no-request-url-fetch
fetch(request.body.url);
// ok: corridra-no-request-url-fetch
fetch('https://example.invalid/fixed-adapter');
