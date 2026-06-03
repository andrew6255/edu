import crypto from 'crypto';

async function testMyScript() {
  const applicationKey = 'a75f9183-fdc7-4c90-958b-a13c9d587db2';
  const hmacKey = 'e07209ce-819b-4a2f-9ace-7f3b5172fade';

  const payload = {
    "width": 794,
    "height": 1123,
    "contentType": "Math",
    "configuration": {
      "math": {
        "mimeTypes": ["application/x-latex", "application/vnd.myscript.jiix"]
      }
    },
    "strokeGroups": [
      {
        "penStyle": "color: #000000;",
        "strokes": [
          {
            "x": [100, 110, 120, 130, 140],
            "y": [100, 100, 100, 100, 100],
            "t": [0, 10, 20, 30, 40]
          },
          {
            "x": [120, 120, 120, 120, 120],
            "y": [80, 90, 100, 110, 120],
            "t": [50, 60, 70, 80, 90]
          }
        ]
      }
    ]
  };

  const bodyStr = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha512', applicationKey + hmacKey).update(bodyStr).digest('hex');

  const headers = {
    "Accept": "application/x-latex",
    "Content-Type": "application/json",
    "applicationKey": applicationKey,
    "hmac": hmac
  };

  const res = await fetch("https://cloud.myscript.com/api/v4.0/iink/batch", {
    method: 'POST',
    headers,
    body: bodyStr
  });

  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Response:", text);
}

testMyScript();
