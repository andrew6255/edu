import json

log_path = r'C:\Users\antoi\.gemini\antigravity-ide\brain\9b3715d8-6b70-44bd-acf4-efd1404ffe54\.system_generated\logs\transcript_full.jsonl'
with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            if 'tool_calls' in data:
                for tc in data['tool_calls']:
                    if tc['name'] == 'default_api:write_to_file':
                        content = tc['arguments'].get('CodeContent', '')
                        if 'Program File Explorer' in content or 'function ProgramsAdmin' in content:
                            print(f"Found Python script or file: {tc['arguments'].get('TargetFile')}")
                            # Let's save it to a file
                            with open(f"extracted_{tc['arguments'].get('TargetFile').replace('c:\\', '').replace('\\', '_').replace(':', '_').replace('/', '_')}.txt", 'w', encoding='utf-8') as out:
                                out.write(content)
        except Exception as e:
            pass
