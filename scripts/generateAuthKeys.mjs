import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const privatePem = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString()
  .trimEnd()
  .replace(/\n/g, " ");

const publicJwk = publicKey.export({ format: "jwk" });
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicJwk }] });

process.stdout.write(`JWT_PRIVATE_KEY="${privatePem}"\n`);
process.stdout.write(`JWKS=${jwks}\n`);
process.stdout.write(
  "\nSet both values on the Convex deployment. Do not commit them.\n",
);
