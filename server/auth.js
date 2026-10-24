import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
export const hashPw = (pw, salt = randomBytes(16).toString("hex")) => ({
  salt,
  hash: scryptSync(pw, salt, 64).toString("hex"),
});
export const verifyPw = (pw, salt, hash) => {
  try {
    const a = Buffer.from(scryptSync(String(pw), salt, 64).toString("hex")),
      b = Buffer.from(hash);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
};
export const newToken = () => randomBytes(24).toString("hex");
