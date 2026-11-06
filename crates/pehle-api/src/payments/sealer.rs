//! Encrypts sellers' payment gateway secrets at rest (AES-256-GCM, random 96-bit nonce prepended).
//! The key comes from `PEHLE_SECRET_KEY` (32 bytes, base64). Losing the key only means sellers must
//! reconnect their gateway; it never exposes funds.

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Nonce};
use anyhow::{Context, Result, anyhow, bail};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

#[derive(Clone)]
pub struct Sealer {
    cipher: Aes256Gcm,
}

impl std::fmt::Debug for Sealer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Sealer(..)")
    }
}

const NONCE_LEN: usize = 12;

impl Sealer {
    pub fn from_base64(key: &str) -> Result<Self> {
        let bytes = STANDARD.decode(key.trim()).context("PEHLE_SECRET_KEY is not base64")?;
        if bytes.len() != 32 {
            bail!("PEHLE_SECRET_KEY must decode to 32 bytes, got {}", bytes.len());
        }
        let cipher = Aes256Gcm::new_from_slice(&bytes).map_err(|_| anyhow!("invalid key length"))?;
        Ok(Self { cipher })
    }

    pub fn seal(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let mut out = nonce.to_vec();
        out.extend(self.cipher.encrypt(&nonce, plaintext).map_err(|_| anyhow!("encryption failed"))?);
        Ok(out)
    }

    pub fn open(&self, sealed: &[u8]) -> Result<Vec<u8>> {
        if sealed.len() <= NONCE_LEN {
            bail!("sealed value too short");
        }
        let (nonce, ciphertext) = sealed.split_at(NONCE_LEN);
        self.cipher
            .decrypt(Nonce::from_slice(nonce), ciphertext)
            .map_err(|_| anyhow!("could not decrypt: wrong PEHLE_SECRET_KEY or corrupted value"))
    }

    pub fn open_string(&self, sealed: &[u8]) -> Result<String> {
        String::from_utf8(self.open(sealed)?).context("decrypted value is not UTF-8")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sealer() -> Sealer {
        Sealer::from_base64(&STANDARD.encode([7u8; 32])).unwrap()
    }

    #[test]
    fn round_trips_and_uses_fresh_nonces() {
        let s = sealer();
        let a = s.seal(b"rzp_secret").unwrap();
        let b = s.seal(b"rzp_secret").unwrap();
        assert_ne!(a, b);
        assert_eq!(s.open_string(&a).unwrap(), "rzp_secret");
    }

    #[test]
    fn rejects_tampering_and_wrong_keys() {
        let s = sealer();
        let mut sealed = s.seal(b"rzp_secret").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        assert!(s.open(&sealed).is_err());
        let other = Sealer::from_base64(&STANDARD.encode([9u8; 32])).unwrap();
        assert!(other.open(&s.seal(b"x").unwrap()).is_err());
        assert!(Sealer::from_base64("c2hvcnQ=").is_err());
    }
}
