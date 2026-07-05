import re

with open("src/views/PersonalProgramView.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update Props
props_repl = """interface Props {
  programId: string | null;
  onBack: () => void;
  sandboxData?: PersonalProgramData;
  sandboxMeta?: PersonalProgramMeta;
}"""
content = re.sub(r'interface Props\s*\{.*?\}', props_repl, content, flags=re.DOTALL)

# 2. Update Component Signature
sig_repl = """export default function PersonalProgramView({ programId, onBack, sandboxData, sandboxMeta }: Props) {"""
content = content.replace("export default function PersonalProgramView({ programId, onBack }: Props) {", sig_repl)

# 3. Add sandboxWhiteboards state
if "const [sandboxWhiteboards" not in content:
    idx = content.find("const [whiteboardPages, setWhiteboardPages] = useState<WhiteboardPageData[] | null>(null);")
    state_repl = "const [whiteboardPages, setWhiteboardPages] = useState<WhiteboardPageData[] | null>(null);\n  const [sandboxWhiteboards, setSandboxWhiteboards] = useState<Record<string, WhiteboardPageData[]>>({});"
    content = content.replace("const [whiteboardPages, setWhiteboardPages] = useState<WhiteboardPageData[] | null>(null);", state_repl)

# 4. Update data fetching useEffect
fetch_effect = """  // Load program metadata and data
  useEffect(() => {
    if (sandboxData && sandboxMeta) {
      setProgramData(sandboxData);
      setMeta(sandboxMeta);
      setLoading(false);
      return;
    }
    if (!user || !programId) return;
    let cancelled = false;"""
content = content.replace("""  // Load program metadata and data
  useEffect(() => {
    if (!user || !programId) return;
    let cancelled = false;""", fetch_effect)

# 5. Update openQuestion
open_q = """  // Open question whiteboard
  const openQuestion = useCallback(async (questionId: string) => {
    setActiveQuestionId(questionId);
    if (sandboxData) {
      setWhiteboardPages(sandboxWhiteboards[questionId] || null);
      return;
    }
    if (!user || !programId) return;
    setLoadingWhiteboard(true);"""
content = content.replace("""  // Open question whiteboard
  const openQuestion = useCallback(async (questionId: string) => {
    if (!user || !programId) return;
    setActiveQuestionId(questionId);
    setLoadingWhiteboard(true);""", open_q)

# 6. Update auto-save
auto_save = """  // Auto-save whiteboard
  const handleWhiteboardPagesChange = useCallback((pages: any[]) => {
    if (!activeQuestionId) return;
    if (sandboxData) {
      setSandboxWhiteboards(prev => ({ ...prev, [activeQuestionId]: pages }));
      return;
    }
    if (!user || !programId) return;
    latestPagesRef.current = pages as WhiteboardPageData[];"""
content = content.replace("""  // Auto-save whiteboard
  const handleWhiteboardPagesChange = useCallback((pages: any[]) => {
    if (!user || !programId || !activeQuestionId) return;
    latestPagesRef.current = pages as WhiteboardPageData[];""", auto_save)

# 7. Update closeWhiteboard
close_w = """  // Close whiteboard and save
  const closeWhiteboard = useCallback(async () => {
    if (sandboxData) {
      setActiveQuestionId(null);
      setWhiteboardPages(null);
      return;
    }
    if (saveTimerRef.current) {"""
content = content.replace("""  // Close whiteboard and save
  const closeWhiteboard = useCallback(async () => {
    if (saveTimerRef.current) {""", close_w)

# 8. Update handleToggleSolved
toggle_s = """  const handleToggleSolved = async (e: React.MouseEvent, questionId: string) => {
    e.stopPropagation();
    if (sandboxData) {
      setAnsweredIds(prev => {
        const next = new Set(prev);
        if (next.has(questionId)) next.delete(questionId);
        else next.add(questionId);
        return next;
      });
      return;
    }
    if (!user || !programId) return;"""
content = content.replace("""  const handleToggleSolved = async (e: React.MouseEvent, questionId: string) => {
    e.stopPropagation();
    if (!user || !programId) return;""", toggle_s)

with open("src/views/PersonalProgramView.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("Applied PersonalProgramView patches")
