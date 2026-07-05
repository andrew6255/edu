import json

log_path = r'C:\Users\antoi\.gemini\antigravity-ide\brain\9b3715d8-6b70-44bd-acf4-efd1404ffe54\.system_generated\logs\transcript_full.jsonl'
found = False
with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            if 'tool_calls' in data:
                for tc in data['tool_calls']:
                    args_str = json.dumps(tc.get('arguments', {}))
                    if '📂' in args_str or 'Program File Explorer' in args_str:
                        print(f"Found in tool: {tc['name']}")
                        with open("recovered_explorer.txt", "a", encoding="utf-8") as out:
                            out.write(args_str + "\n\n====================\n\n")
                        found = True
            
            # also check model messages? the model might have printed it in content
            if 'content' in data:
                if '📂' in data['content'] or 'Program File Explorer' in data['content']:
                    with open("recovered_explorer.txt", "a", encoding="utf-8") as out:
                        out.write(data['content'] + "\n\n====================\n\n")
                        found = True
        except Exception as e:
            pass

if found:
    print("Successfully recovered some code!")
else:
    print("Nothing found.")
