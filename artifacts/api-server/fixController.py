import re

path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\api-server\src\modules\program-ingestion\controller.ts'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# I will find the end of `extractMcqFromText` and replace everything after it with the correct `extractIqPdf`
start_idx = code.find("export async function extractIqPdf")
if start_idx == -1:
    # If the previous replace messed up the export line, let's find the end of the previous function
    prev_func_idx = code.find("export async function extractMcqFromText")
    
    # find the end of the previous function
    idx = code.find("\n}", prev_func_idx)
    idx = code.find("\n}", idx + 1)
    
    start_idx = idx + 2

correct_func = """

export async function extractIqPdf(req: Request, res: Response): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "PDF file is required" });
      return;
    }

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const path = await import("node:path");
    
    const execFileAsync = promisify(execFile);
    const scriptPath = path.resolve(process.cwd(), "src/modules/program-ingestion/pdf_extractor.py");
    
    // Run python script
    const { stdout } = await execFileAsync("python", [scriptPath, file.path], {
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
    });
    
    const extractedData = JSON.parse(stdout);
    
    // Clean up temp file
    const fs = await import("node:fs/promises");
    await fs.unlink(file.path).catch(console.warn);

    // Prepare full text for Groq
    const allText = extractedData.pages.map((p: any) => p.text).join("\\n\\n");
    // Collect all images to heuristically assign later
    let allImages: string[] = [];
    extractedData.pages.forEach((p: any) => {
        if (p.images && p.images.length > 0) {
            allImages.push(...p.images);
        }
    });

    const apiKey = process.env["GROQ_API_KEY"];
    if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");

    const url = "https://api.groq.com/openai/v1/chat/completions";
    const prompt = `You are an expert curriculum developer. Given the following raw text extracted from an Olympiad/IQ test PDF, identify all the Multiple Choice Questions (MCQs).
Extract them into a JSON array of objects, where each object has the following structure:
{
  "promptRawText": "The question text",
  "interaction": {
    "type": "mcq",
    "choices": ["Choice A text", "Choice B text", "Choice C text", "Choice D text", "Choice E text"],
    "correctChoiceIndex": 0
  }
}
If the correct answer is not explicitly given in the text, make your best guess for the correctChoiceIndex. If you absolutely cannot guess, use -1.
Output ONLY a valid JSON object containing a "questions" array.

Raw text:
${allText}
`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You output valid JSON containing a 'questions' array." },
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq request failed with status ${response.status}: ${errorText}`);
    }

    const payload = await response.json() as any;
    let responseText = payload.choices?.[0]?.message?.content?.trim();
    if (!responseText) throw new Error("Groq response empty");

    let jsonArray;
    try {
      const parsed = JSON.parse(responseText);
      jsonArray = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    } catch (e) {
      jsonArray = [];
    }

    // Heuristic image assignment: just assign sequentially for now if there are images
    const formattedQuestions = jsonArray.map((item: any, i: number) => {
       const resObj: any = {
          promptRawText: item.promptRawText,
          interaction: item.interaction
       };
       if (i < allImages.length) {
           resObj.imageUrl = allImages[i];
       }
       return resObj;
    });

    res.json({ questions: formattedQuestions });

  } catch (error) {
    console.error("extractIqPdf error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
"""

with open(path, 'w', encoding='utf-8') as f:
    f.write(code[:start_idx] + correct_func)

print("Updated successfully")
