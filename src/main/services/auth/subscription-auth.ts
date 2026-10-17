import { saveKey } from '../credential-vault';

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe81';
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export interface CopilotDeviceFlowData {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface CopilotPollResult {
  success: boolean;
  token?: string;
  error?: string;
}

/**
 * Initiates the GitHub Copilot OAuth Device Flow (RFC 8628).
 * Requests a device verification code from GitHub.
 */
export async function initiateCopilotDeviceFlow(): Promise<CopilotDeviceFlowData> {
  console.log('[SUBSCRIPTION-AUTH] Initiating GitHub Copilot device flow...');

  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Ty-Code-Desktop/1.0'
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: 'read:user'
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GitHub OAuth device code request failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as CopilotDeviceFlowData;
  console.log(`[SUBSCRIPTION-AUTH] Device code issued: user_code=${data.user_code}, uri=${data.verification_uri}`);
  return data;
}

/**
 * Polls GitHub's OAuth token endpoint until the user authenticates in their browser,
 * the code expires, or the request times out.
 * On success, seals the token into safeStorage via saveKey('copilot', token).
 */
export async function pollCopilotToken(
  deviceCode: string,
  initialInterval: number = 5,
  maxWaitSeconds: number = 300
): Promise<CopilotPollResult> {
  console.log(`[SUBSCRIPTION-AUTH] Polling GitHub for device code authorization (timeout: ${maxWaitSeconds}s)...`);
  const startTime = Date.now();
  let intervalMs = Math.max(2000, initialInterval * 1000);

  while (Date.now() - startTime < maxWaitSeconds * 1000) {
    // Wait for the requested polling interval
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    try {
      const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Ty-Code-Desktop/1.0'
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        continue;
      }

      const json = (await response.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
        interval?: number;
      };

      if (json.access_token) {
        console.log('[SUBSCRIPTION-AUTH] User authenticated successfully! Saving Copilot token...');
        await saveKey('copilot', json.access_token);
        await saveKey('github-copilot', json.access_token);
        return { success: true, token: json.access_token };
      }

      if (json.error === 'authorization_pending') {
        // Continue waiting
        continue;
      }

      if (json.error === 'slow_down') {
        intervalMs += 5000;
        continue;
      }

      if (json.error === 'expired_token') {
        return { success: false, error: 'Verification code expired. Please request a new code.' };
      }

      if (json.error === 'access_denied') {
        return { success: false, error: 'Authorization was denied by user.' };
      }

      if (json.error) {
        return { success: false, error: json.error_description || json.error };
      }
    } catch (err: unknown) {
      console.warn('[SUBSCRIPTION-AUTH] Polling ping error:', err);
    }
  }

  return { success: false, error: 'Authentication polling timed out. Please try again.' };
}
