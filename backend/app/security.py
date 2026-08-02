from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


@dataclass(frozen=True, slots=True)
class CookieSigner:
    secret: bytes

    def issue(self, purpose: str, ttl_seconds: int) -> str:
        payload = {
            "purpose": purpose,
            "expires": int(time.time()) + ttl_seconds,
            "nonce": secrets.token_urlsafe(12),
        }
        encoded = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        signature = _b64encode(hmac.new(self.secret, encoded.encode("ascii"), hashlib.sha256).digest())
        return f"{encoded}.{signature}"

    def verify(self, token: str | None, purpose: str) -> bool:
        if not token or "." not in token:
            return False
        encoded, supplied_signature = token.rsplit(".", 1)
        expected_signature = _b64encode(
            hmac.new(self.secret, encoded.encode("ascii"), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(supplied_signature, expected_signature):
            return False
        try:
            payload = json.loads(_b64decode(encoded))
            expires = int(payload["expires"])
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            return False
        return payload.get("purpose") == purpose and expires >= int(time.time())

