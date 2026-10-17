import requests
import json
import sys

# CORRECTED URL based on official Kilo Gateway docs
url = "https://api.kilo.ai/api/gateway/chat/completions"
headers = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream"
}
payload = {
    "model": "kilo-auto/free",
    "messages": [{"role": "user", "content": "Reply with exactly: PYTHON_BACKEND_TEST_SUCCESS"}],
    "stream": True
}

print(f"🔍 Attempting connection to: {url}")
print(f"📦 Payload: {json.dumps(payload, indent=2)}\n")

try:
    response = requests.post(url, headers=headers, json=payload, stream=True, timeout=15)
    print(f"✅ Status Code: {response.status_code}")
    
    if response.status_code == 200:
        print("🌊 Streaming response:\n")
        full_response = ""
        for line in response.iter_lines():
            if line:
                decoded_line = line.decode('utf-8')
                if decoded_line.startswith('data: '):
                    data_str = decoded_line[6:]
                    if data_str == '[DONE]':
                        break
                    try:
                        data = json.loads(data_str)
                        content = data['choices'][0]['delta'].get('content', '')
                        if content:
                            print(content, end='', flush=True)
                            full_response += content
                    except json.JSONDecodeError:
                        pass
        print("\n\n" + "="*50)
        print("SUCCESS! Backend connectivity is proven.")
        print("="*50)
        
        # Save the exact working configuration for the AI to copy
        with open('working_api_config.json', 'w') as f:
            json.dump({
                "url": url,
                "headers": headers,
                "payload": payload,
                "status": response.status_code,
                "note": "This exact HTTP request works. The Node.js backend MUST replicate this."
            }, f, indent=2)
        print("💾 Saved working configuration to: working_api_config.json")
        
    else:
        print(f"❌ Failed. Status: {response.status_code}")
        print(f"Response Body (first 500 chars): {response.text[:500]}")
        sys.exit(1)
        
except requests.exceptions.RequestException as e:
    print(f"❌ Network Error: {e}")
    print("Check your internet connection, firewall, or proxy settings.")
    sys.exit(1)