import { check, same } from "../../auto.mjs";
import { httpOnce } from "./http-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/** Every range of docs 3.configuration.md "Private network in HTTP requests", with addresses at and inside its edges. */
export const BLOCKED = [
  { range: "Loopback 127.0.0.0/8", hosts: ["127.0.0.1", "127.0.0.0", "127.255.255.255", "127.1.2.3"] },
  { range: "Loopback ::1", hosts: ["[::1]"] },
  { range: "Unspecified 0.0.0.0/8", hosts: ["0.0.0.0", "0.255.255.255"] },
  { range: "Unspecified ::", hosts: ["[::]"] },
  { range: "Private 10.0.0.0/8", hosts: ["10.0.0.1", "10.255.255.255"] },
  { range: "Private 172.16.0.0/12", hosts: ["172.16.0.0", "172.31.255.255"] },
  { range: "Private 192.168.0.0/16", hosts: ["192.168.0.1", "192.168.255.255"] },
  { range: "Private fc00::/7", hosts: ["[fc00::1]", "[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]"] },
  { range: "Carrier-grade NAT 100.64.0.0/10", hosts: ["100.64.0.0", "100.127.255.255"] },
  { range: "Link-local 169.254.0.0/16 with the cloud metadata address", hosts: ["169.254.169.254", "169.254.0.0", "169.254.255.255"] },
  { range: "Link-local fe80::/10", hosts: ["[fe80::1]", "[febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff]"] },
  { range: "Multicast 224.0.0.0/4", hosts: ["224.0.0.1", "239.255.255.255"] },
  { range: "Reserved 240.0.0.0/4", hosts: ["240.0.0.1", "255.255.255.255"] },
  { range: "Multicast ff00::/8", hosts: ["[ff02::1]", "[ff00::]"] },
  { range: "NAT64 64:ff9b::/96 embedding 127.0.0.1", hosts: ["[64:ff9b::7f00:1]"] },
  { range: "NAT64 embedding 10.0.0.1, 172.16.0.1, 192.168.1.1, 169.254.169.254", hosts: ["[64:ff9b::a00:1]", "[64:ff9b::ac10:1]", "[64:ff9b::c0a8:101]", "[64:ff9b::a9fe:a9fe]"] },
  { range: "Another spelling of loopback", hosts: ["2130706433", "0x7f000001", "017700000001", "0x7f.1"], shown: "127.0.0.1" },
  { range: "An IPv4-mapped IPv6 address", hosts: ["[::ffff:10.0.0.1]", "[::ffff:127.0.0.1]"], mapped: true },
];

/** Addresses next to a blocked range: the check lets them through to the network. */
export const OPEN = [
  "9.255.255.255",
  "11.0.0.0",
  "172.15.255.255",
  "172.32.0.0",
  "192.167.255.255",
  "192.169.0.0",
  "100.63.255.255",
  "100.128.0.0",
  "169.253.255.255",
  "169.255.0.0",
  "126.255.255.255",
  "128.0.0.0",
  "1.0.0.0",
  "223.255.255.255",
  "[fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]",
  "[fe00::1]",
  "[fec0::1]",
  "[2001:db8::1]",
  "[::2]",
  "[64:ff9b::808:808]",
  "[64:ff9b:1::1]",
];

const SUFFIX = "this server refuses requests to its internal network (httpRequest.blockPrivateNetwork).";

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function blockedChecks(ctx) {
  /** @type {import("../../auto.mjs").Check[]} */
  const checks = [];
  const all = BLOCKED.flatMap((group) => group.hosts.map((host) => ({ ...group, host })));
  for (let start = 0; start < all.length; start += 8) {
    const slice = all.slice(start, start + 8);
    const results = await Promise.all(slice.map((one) => httpOnce(ctx, { url: `http://${one.host}/path`, timeoutMs: 1500 })));
    slice.forEach((one, index) => {
      const result = results[index];
      const message = String(result.error);
      const bare = one.host.replace(/^\[|\]$/g, "");
      checks.push(check(`${one.range}: ${one.host} is refused`, result.ran.status === "failed" && message.includes(`is a private network address (`) && message.endsWith(SUFFIX), message));
      if (!("mapped" in one) && !("shown" in one)) {
        checks.push(check(`${one.host}: the message names the host and the address`, message.endsWith(`failed: ${bare} is a private network address (${bare}): ${SUFFIX}`), message));
      }
      if ("shown" in one) checks.push(check(`${one.host}: the message names the normalized address`, message.endsWith(`failed: ${one.shown} is a private network address (${one.shown}): ${SUFFIX}`), message));
    });
  }
  return checks;
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function openChecks(ctx) {
  /** @type {import("../../auto.mjs").Check[]} */
  const checks = [];
  for (let start = 0; start < OPEN.length; start += 7) {
    const slice = OPEN.slice(start, start + 7);
    const results = await Promise.all(slice.map((host) => httpOnce(ctx, { url: `http://${host}/`, timeoutMs: 1200 })));
    slice.forEach((host, index) => {
      checks.push(check(`${host} is not refused as a private address`, !String(results[index].error).includes("private network address") && !String(results[index].error).includes("internal network"), String(results[index].error)));
    });
  }
  return checks;
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} base The sink
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function namedHostChecks(ctx, base) {
  const local = await httpOnce(ctx, { url: "http://localhost:9/" });
  const sink = await httpOnce(ctx, { url: `${base}/echo` });
  const capped = await httpOnce(ctx, { url: `${base}/echo`, timeoutMs: 1000 });
  return [
    check("localhost is refused once it resolves to loopback", /^GET http:\/\/localhost:9\/ failed: localhost is a private network address \((127\.0\.0\.1|::1)\): /.test(String(local.error)) && String(local.error).endsWith(SUFFIX), String(local.error)),
    same("the sink on loopback is refused with its address", [sink.ran.status, String(sink.error).endsWith(`is a private network address (127.0.0.1): ${SUFFIX}`)], ["failed", true]),
    same("a refused request makes no request", capped.ran.status, "failed"),
  ];
}
