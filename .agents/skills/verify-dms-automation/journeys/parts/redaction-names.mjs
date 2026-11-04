/** Header and query names the docs list as credentials, with the rule that makes them one. */
export const CREDENTIAL_NAMES = [
  ["Authorization", "exact"], ["AUTHORIZATION", "exact, any case"], ["Proxy-Authorization", "exact"], ["Cookie", "exact"], ["COOKIE", "exact, any case"], ["Set-Cookie", "exact"],
  ["auth", "exact"], ["AUTH", "exact, any case"], ["key", "exact"], ["Key", "exact, any case"], ["sig", "exact"], ["SIG", "exact, any case"],
  ["x-token", "contains token"], ["accessTOKEN", "contains token, any case"], ["tokens", "contains token"], ["client_secret", "contains secret"], ["X-Secret-Thing", "contains secret"],
  ["X-Signature", "contains signature"], ["x-hub-HMAC-sha256", "contains hmac"], ["Password", "contains password"], ["db_passwd", "contains passwd"],
  ["sessionid", "contains session"], ["X-Session-Id", "contains session"], ["X-ApiKey", "contains apikey"], ["x-api-key", "contains api-key"], ["X_API_KEY", "contains api_key"],
  ["accesskey", "contains accesskey"], ["Access-Key-Id", "contains access-key"], ["aws_access_key_id", "contains access_key"],
  ["X-Auth-User", "starts with x-auth"], ["x-authentication", "starts with x-auth"], ["X-AUTH", "starts with x-auth, any case"],
  ["x-custom-key", "ends with -key"], ["My_Key", "ends with _key"], ["Stripe-KEY", "ends with -key, any case"],
];

/** Names close to the credential rules that must keep their value. */
export const PLAIN_NAMES = [
  "accept", "Content-Type", "user-agent", "author", "authorizations", "keyboard", "monkey", "key-id", "my-keys", "signal", "design", "sigma", "pass", "passenger", "xauth", "x-aut", "x-request-id", "tenant", "ÀccéNT-日本",
];
