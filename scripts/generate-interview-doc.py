import os
import sys
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls

def set_cell_background(cell, fill_hex):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=120, bottom=120, left=180, right=180):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(
        f'<w:tcMar {nsdecls("w")}>'
        f'<w:top w:w="{top}" w:type="dxa"/>'
        f'<w:bottom w:w="{bottom}" w:type="dxa"/>'
        f'<w:left w:w="{left}" w:type="dxa"/>'
        f'<w:right w:w="{right}" w:type="dxa"/>'
        f'</w:tcMar>'
    )
    tcPr.append(tcMar)

def add_callout(doc, title, text, bg_hex="F1F5F9", border_hex="4F46E5"):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    
    cell = table.cell(0, 0)
    cell.width = Inches(6.5)
    set_cell_background(cell, bg_hex)
    set_cell_margins(cell, top=140, bottom=140, left=200, right=200)
    
    tcPr = cell._tc.get_or_add_tcPr()
    borders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>'
        f'<w:left w:val="single" w:sz="24" w:space="0" w:color="{border_hex}"/>'
        f'<w:top w:val="none"/>'
        f'<w:right w:val="none"/>'
        f'<w:bottom w:val="none"/>'
        f'</w:tcBorders>'
    )
    tcPr.append(borders)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(4)
    run_title = p.add_run(f"KEY TAKEAWAY: {title}\n")
    run_title.bold = True
    run_title.font.name = "Calibri"
    run_title.font.size = Pt(10.5)
    run_title.font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)
    
    run_text = p.add_run(text)
    run_text.font.name = "Calibri"
    run_text.font.size = Pt(10)
    run_text.font.color.rgb = RGBColor(0x33, 0x41, 0x55)
    
    doc.add_paragraph().paragraph_format.space_after = Pt(6)

def add_code_block(doc, code_str):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    
    cell = table.cell(0, 0)
    cell.width = Inches(6.5)
    set_cell_background(cell, "0F172A")
    set_cell_margins(cell, top=140, bottom=140, left=200, right=200)
    
    tcPr = cell._tc.get_or_add_tcPr()
    borders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>'
        f'<w:left w:val="single" w:sz="12" w:space="0" w:color="38BDF8"/>'
        f'<w:top w:val="none"/>'
        f'<w:right w:val="none"/>'
        f'<w:bottom w:val="none"/>'
        f'</w:tcBorders>'
    )
    tcPr.append(borders)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.15
    run = p.add_run(code_str)
    run.font.name = "Consolas"
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0xF8, 0xFA, 0xFC)
    
    doc.add_paragraph().paragraph_format.space_after = Pt(6)

def create_interview_doc(output_path):
    doc = Document()
    
    # Page setup
    for section in doc.sections:
        section.top_margin = Inches(0.75)
        section.bottom_margin = Inches(0.75)
        section.left_margin = Inches(0.75)
        section.right_margin = Inches(0.75)
        
        # Header & Footer
        header = section.header
        hp = header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hrun = hp.add_run("Ty-Code | Architecture and Technical Interview Master Guide")
        hrun.font.name = "Calibri"
        hrun.font.size = Pt(8.5)
        hrun.font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)
        
        footer = section.footer
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        frun = fp.add_run("Developer and Software Architect Role Interview Preparation")
        frun.font.name = "Calibri"
        frun.font.size = Pt(8.5)
        frun.font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)

    # Styles
    styles = doc.styles
    normal_style = styles['Normal']
    normal_style.font.name = 'Calibri'
    normal_style.font.size = Pt(11)
    normal_style.font.color.rgb = RGBColor(0x33, 0x41, 0x55)
    normal_style.paragraph_format.line_spacing = 1.2
    normal_style.paragraph_format.space_after = Pt(6)

    # Document Title Block
    title_p = doc.add_paragraph()
    title_p.paragraph_format.space_before = Pt(12)
    title_p.paragraph_format.space_after = Pt(2)
    run_title = title_p.add_run("TY-CODE: ARCHITECTURE & TECHNICAL INTERVIEW GUIDE")
    run_title.bold = True
    run_title.font.name = "Segoe UI"
    run_title.font.size = Pt(22)
    run_title.font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)

    sub_p = doc.add_paragraph()
    sub_p.paragraph_format.space_after = Pt(16)
    run_sub = sub_p.add_run("Senior Developer and Software Architect Role Interview Preparation.\nSystem Design, Tech Stack Rationale, API Normalization, Security Sandbox, and Production Use Cases.")
    run_sub.font.name = "Segoe UI"
    run_sub.font.size = Pt(12)
    run_sub.font.color.rgb = RGBColor(0x4F, 0x46, 0xE5)

    # Divider line
    div_p = doc.add_paragraph()
    div_p.paragraph_format.space_after = Pt(16)
    pBdr = parse_xml(f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="18" w:space="1" w:color="4F46E5"/></w:pBdr>')
    div_p._p.get_or_add_pPr().append(pBdr)

    # Heading helpers
    def add_h1(text):
        h = doc.add_paragraph()
        h.paragraph_format.space_before = Pt(18)
        h.paragraph_format.space_after = Pt(6)
        h.paragraph_format.keep_with_next = True
        r = h.add_run(text)
        r.bold = True
        r.font.name = "Segoe UI"
        r.font.size = Pt(16)
        r.font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)
        pBdr = parse_xml(f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="8" w:space="4" w:color="CBD5E1"/></w:pBdr>')
        h._p.get_or_add_pPr().append(pBdr)

    def add_h2(text):
        h = doc.add_paragraph()
        h.paragraph_format.space_before = Pt(14)
        h.paragraph_format.space_after = Pt(4)
        h.paragraph_format.keep_with_next = True
        r = h.add_run(text)
        r.bold = True
        r.font.name = "Segoe UI"
        r.font.size = Pt(13)
        r.font.color.rgb = RGBColor(0x4F, 0x46, 0xE5)

    def add_h3(text):
        h = doc.add_paragraph()
        h.paragraph_format.space_before = Pt(10)
        h.paragraph_format.space_after = Pt(3)
        h.paragraph_format.keep_with_next = True
        r = h.add_run(text)
        r.bold = True
        r.font.name = "Segoe UI"
        r.font.size = Pt(11.5)
        r.font.color.rgb = RGBColor(0x0F, 0x17, 0x2A)

    def add_qa(q_text, a_text, category="Technical Deep-Dive"):
        add_h3(f"Q: {q_text}")
        cat_p = doc.add_paragraph()
        cat_p.paragraph_format.space_after = Pt(4)
        cat_run = cat_p.add_run(f"Focus Area: {category}")
        cat_run.font.size = Pt(9.5)
        cat_run.font.italic = True
        cat_run.font.color.rgb = RGBColor(0x64, 0x74, 0x8B)
        
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(10)
        run = p.add_run(a_text)
        run.font.size = Pt(10.5)

    # -------------------------------------------------------------
    # SECTION 1: THE EXECUTIVE PITCH
    # -------------------------------------------------------------
    add_h1("1. The Executive Pitch and Product Vision")
    
    add_h2("The 30-Second Elevator Pitch")
    doc.add_paragraph(
        "\"Ty-Code is a local-first, standalone AI coding IDE built on Electron, React 18, and Monaco Editor. "
        "Unlike cloud-locked tools such as Cursor or Copilot, Ty-Code uses a zero-trust, Bring-Your-Own-Key model. "
        "It provides a unified multi-provider gateway. This gateway connects to proprietary cloud APIs, local offline LLMs via Ollama, "
        "and decentralized free tiers via OpenKilo and FCC. The platform includes automated quota balancing, local credential encryption "
        "using OS safeStorage, and a secure agent execution sandbox.\""
    )
    
    add_h2("The 2-Minute Architectural Pitch (For Directors and Architects)")
    doc.add_paragraph(
        "\"I designed Ty-Code to address three major problems in current AI developer tools: vendor lock-in, unpredictable costs, "
        "and cloud privacy risks.\n\n"
        "The system uses a three-tier desktop architecture:\n\n"
        "1. Renderer Process: Built with React 18, Vite, and Zustand. It hosts the Monaco Editor, an XTerm.js terminal emulator, "
        "and an interactive M3E UI Canvas sketcher running in a separate window.\n\n"
        "2. Preload and ContextBridge Layer: A strictly typed IPC boundary. It uses Zod schemas to validate all messages and prevent "
        "prototype pollution.\n\n"
        "3. Main Process and Agent Core: A Node.js engine managing native pseudo-terminals via node-pty, background Language Server Protocol daemons, "
        "a ReAct agent execution loop, and a unified ProviderGateway.\n\n"
        "The gateway normalizes different streaming protocols into one standard stream. An adaptive router inspects task complexity. "
        "It sends reasoning tasks to large models and fast edits to local or low-latency models. Source code and credentials remain encrypted "
        "locally and never leave the machine in plaintext.\""
    )

    add_callout(
        doc,
        "Core Value Proposition",
        "Ty-Code proves that an AI coding assistant can deliver high productivity without sending private code to a third-party cloud. "
        "It provides complete data sovereignty and unified multi-model routing."
    )

    # -------------------------------------------------------------
    # SECTION 2: TECH STACK AND ARCHITECTURAL DECISIONS
    # -------------------------------------------------------------
    add_h1("2. Technology Stack Selection and Technical Rationale")
    
    add_qa(
        "Why Electron instead of a Web IDE or a VS Code Extension?",
        "Building Ty-Code as an Electron application was a deliberate choice for three reasons:\n\n"
        "1. Direct OS-Level Privileges: Web browsers cannot spawn native pseudo-terminals (node-pty). They cannot run Language Server Protocol "
        "binaries or access local files without constant permission prompts. Electron provides full native capabilities.\n\n"
        "2. Data Sovereignty and Offline Use: Enterprise teams with sensitive code cannot send files through remote proxy servers. "
        "Electron allows Ty-Code to connect directly to local models (such as Ollama or vLLM) on localhost with zero internet access required.\n\n"
        "3. Why Not a VS Code Extension? VS Code extensions run inside a restricted sandbox. They cannot control window lifecycles, "
        "create separate windows like our M3E Canvas, customize window chrome, or enforce custom OS-level security policies.",
        "Platform Architecture"
    )

    add_qa(
        "Why Monaco Editor instead of CodeMirror or Ace Editor?",
        "Monaco Editor was selected for three clear reasons:\n\n"
        "1. Developer Familiarity: Monaco is the editor engine inside VS Code. Developers already know its keybindings, multi-cursor editing, "
        "minimap, and bracket matching. There is no learning curve.\n\n"
        "2. Built-in DiffEditor: When the agent proposes code edits over 5 lines, Ty-Code requires visual review. Monaco includes a production-grade "
        "DiffEditor that shows side-by-side and inline visual diffs with individual chunk acceptance.\n\n"
        "3. Language Server Integration: Monaco aligns directly with Language Server Protocol data structures. This simplifies showing real-time "
        "diagnostics, auto-completions, and type definitions.",
        "Editor Architecture"
    )

    add_qa(
        "Why Zustand for state management instead of Redux Toolkit or React Context?",
        "Zustand was chosen over Redux and Context due to performance during high-speed AI streaming:\n\n"
        "1. No Cascading Re-renders: Language models stream at 50 to 150 tokens per second. React Context re-renders every consuming component "
        "on every token update. Zustand uses atomic selector subscriptions. Only the specific status badge or token counter updates.\n\n"
        "2. Out-of-React State Dispatch: Zustand stores can be read and updated outside React components via getState() and setState(). "
        "In an Electron app where IPC events arrive asynchronously, this avoids React hook closure bugs.\n\n"
        "3. Small Footprint: Zustand is under 1KB gzipped, keeping bundle size minimal.",
        "State Management"
    )

    add_qa(
        "Why Vite and esbuild for the build pipeline?",
        "Ty-Code uses a dual build setup:\n\n"
        "• Renderer Process: Vite 6 and React 18 use native ES modules. This delivers instant Hot Module Replacement during development.\n\n"
        "• Main and Preload Processes: Bundled with esbuild targeting Node 20 CommonJS. esbuild compiles native dependencies and TypeScript "
        "in milliseconds while leaving native Node addons external.\n\n"
        "This configuration guarantees sub-second build times across both processes.",
        "Build Engineering"
    )

    # -------------------------------------------------------------
    # SECTION 3: DEEP-DIVE TECHNICAL ARCHITECTURE
    # -------------------------------------------------------------
    add_h1("3. Deep-Dive Technical Architecture and Engineering Solutions")

    add_qa(
        "How does the Unified Provider Gateway normalize different streaming APIs?",
        "Different AI providers use incompatible streaming formats. OpenAI and Groq emit Server-Sent Events. Anthropic uses typed delta events. "
        "Ollama and local servers emit NDJSON lines.\n\n"
        "We built ProviderGateway using the Adapter Pattern. Outbound requests are converted into standard message schemas. "
        "Inbound streams are transformed into unified TypeScript AgentStreamChunk events:\n\n"
        "• 'token': Incremental text deltas.\n"
        "• 'thought': Reasoning tokens for models such as DeepSeek R1 or OpenAI o1.\n"
        "• 'tool_call': Structured tool execution requests.\n"
        "• 'status': Execution state transitions (for example, 'Thinking...').\n\n"
        "If a provider fails or hits rate limits (HTTP 429), the gateway automatically fails over to the next compatible model in the pool.",
        "API Gateway and Normalization"
    )

    add_code_block(
        doc,
        "// Normalized Agent Stream Event Schema\n"
        "export type AgentStreamChunk =\n"
        "  | { taskId: string; type: 'token'; content: string }\n"
        "  | { taskId: string; type: 'thought'; content: string }\n"
        "  | { taskId: string; type: 'status'; content: string }\n"
        "  | { taskId: string; type: 'tool_call'; toolCall: ToolCallDefinition }\n"
        "  | { taskId: string; type: 'approval_request'; approvalRequest: AgentApproval }\n"
        "  | { taskId: string; type: 'diff_proposed'; diff: FileDiffPayload }\n"
        "  | { taskId: string; type: 'done'; usage?: TokenUsageSnapshot }\n"
        "  | { taskId: string; type: 'error'; error: string };"
    )

    add_qa(
        "How do you prevent high-frequency streaming tokens from freezing the UI?",
        "Fast models like Groq can emit over 300 tokens per second. Firing a React state update for each token saturates the JavaScript "
        "event loop and causes dropped frames.\n\n"
        "We implemented a double-buffer flush system in the renderer:\n\n"
        "1. Micro-Batching: Incoming tokens accumulate in an in-memory string buffer.\n"
        "2. 24ms Throttle Window: A requestAnimationFrame throttle synchronizes UI updates with the 60Hz display refresh cycle.\n"
        "3. Deferred Markdown Parsing: Raw text displays immediately during streaming. Full syntax highlighting and markdown parsing "
        "run only after the stream finishes.",
        "Performance Engineering"
    )

    add_qa(
        "How do you minimize Time-to-First-Token (TTFT) and optimize end-to-end streaming latency?",
        "To deliver instantaneous visual feedback without compromising throughput, Ty-Code optimizes latency across three critical tiers:\n\n"
        "1. Main Process Outbound Coalescing with Immediate Chunk #1 Flush:\n"
        "Tokens stream from AI providers through the Main process. Instead of blasting IPC messages per token, tokens coalesce into 16–24ms batches. "
        "Crucially, Chunk #1 bypasses batching and flushes synchronously across IPC in 0ms. This ensures Time-to-First-Token (TTFT) is minimal "
        "while eliminating IPC serialization overhead during sustained 300+ token/s bursts.\n\n"
        "2. Per-Host HTTPS Connection Pooling (keepAlive: true):\n"
        "ProviderGateway maintains persistent HTTPS agents and Undici dispatchers per provider host with keepAlive: true, 15-second keepalive timeouts, "
        "and socket reuse. Sequential prompts reuse active TLS sessions and TCP connections, saving 80 to 250ms of handshake latency per request.\n\n"
        "3. CSS Layout Containment & Virtualization:\n"
        "Message rows are virtualized via @tanstack/react-virtual and isolated with React.memo. Each message container applies content-visibility: auto "
        "and contain-intrinsic-size: auto 130px. Off-screen conversation turns completely bypass layout and paint calculations until scrolled into view.\n\n"
        "4. Deferred AST Syntax Highlighting:\n"
        "During live streaming, messages render raw text through ScrambleText. Heavy markdown AST construction and highlight.js tokenization run only once "
        "upon receiving the [DONE] stream termination token.",
        "Latency Optimization & Network Architecture"
    )

    add_qa(
        "Explain the Smart Sticky-Scroll Auto-Follow algorithm and how you prevented layout jumps and per-pixel re-renders.",
        "Implementing auto-scrolling during high-speed AI streaming is fraught with edge cases: programmatic smooth scrolling queues animations, "
        "deferred markdown highlighting shifts container heights, and reading scroll position in React state causes catastrophic per-pixel re-renders.\n\n"
        "We designed a multi-layer Smart Sticky-Scroll architecture in ChatMessageList:\n\n"
        "1. Ref-Based Pin Detection (Zero Re-render Cost):\n"
        "We track pinned state using const pinnedToBottom = useRef(true). A { passive: true } scroll listener throttled by requestAnimationFrame computes "
        "distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight. The user is considered pinned when distanceFromBottom < 64px. "
        "A single piece of React state (detachedFromBottom) flips ONLY when the boolean changes value, guaranteeing zero React re-renders while scrolling.\n\n"
        "2. Auto-Follow on Buffer Flush (Behavior: 'auto'):\n"
        "After each 24ms double-buffered flush commits text to the DOM, if pinnedToBottom.current is true, el.scrollTop = el.scrollHeight executes using behavior 'auto'. "
        "Programmatic smooth scrolling is strictly prohibited during streaming because queued browser animations cause visual jitter and artificial lag.\n\n"
        "3. ResizeObserver Height Protection:\n"
        "A ResizeObserver monitors the inner virtual container. When post-stream events (syntax highlighting on [DONE], code block expansion, image loading) "
        "increase document height while pinned, the observer re-pins scrollTop immediately. If the user is detached (reading previous messages), the observer "
        "exits immediately, preventing jarring layout jumps.\n\n"
        "4. Floating 'Jump to latest' Pill & Re-Pin Events:\n"
        "When detachedFromBottom is true, a floating pill with an ArrowDown icon and backdrop blur appears bottom-center. Clicking the pill or submitting a "
        "new message forces pinnedToBottom.current = true and triggers a smooth scroll to the bottom. Scrolling manually back within 64px automatically hides the pill.",
        "UI Engineering & DOM Synchronization"
    )

    add_qa(
        "How does the Matrix Decode glyph-scramble animation work, and how did you guarantee zero latency?",
        "To provide a tactile visual aesthetic during token streaming, we built a 'Matrix Decode' glyph-scramble animation (ScrambleText).\n\n"
        "1. Provably Zero Latency:\n"
        "The animation never gates, buffers, delays, or re-requests tokens. It is strictly a decoupled presentation transform operating on text already "
        "committed to the render buffer. Tokens are painted into memory immediately.\n\n"
        "2. Per-Character Dynamic Lock Formula:\n"
        "When character index i first appears in the text buffer, it is assigned a lock timestamp:\n"
        "lockAt = now + 90ms + (i % 5) * 12ms\n"
        "On each animation frame, characters where lockAt <= now render as their real glyph. Unlocked characters render a pseudo-random glyph from a Katakana "
        "and hex charset ('アイウエオカキクケコサシスセソ0123456789ABCDEF#$%&'). Whitespace and newlines are never scrambled to prevent word-wrap shifts.\n\n"
        "3. Bounded O(1) Trailing Window:\n"
        "To prevent CPU degradation on long responses, scrambling is strictly bounded to the trailing 200 characters (SCRAMBLE_WINDOW = 200). "
        "All older characters render permanently locked with zero per-frame CPU computation.\n\n"
        "4. Lifecycle & Accessibility Guards:\n"
        "• Single Self-Cancelling rAF Loop: Starts only when unlocked characters exist and auto-terminates when all characters lock or upon unmount.\n"
        "• Tab Visibility Guard: Automatically pauses the rAF loop when document.hidden is true.\n"
        "• Reduced Motion: Respects prefers-reduced-motion: reduce by immediately rendering locked text.\n"
        "• Accessibility: Uses aria-label={text} and aria-live='off' so screen readers receive clean canonical prose without scrambled characters.",
        "Animation Performance & Accessibility"
    )

    add_qa(
        "How does Ty-Code enforce enterprise typography and code-safe UK English punctuation?",
        "Enterprise communication demands consistent typography, rich markdown presentations, and professional punctuation style without corrupting source code.\n\n"
        "1. Zustand Typography System (useTypographyStore):\n"
        "Exposes persistent settings for chatFontFamily ('sans', 'serif', 'mono', 'plex'), chatFontSize (12–18px, default 14), matrixDecodeEnabled, "
        "and ukPunctuationEnabled. Subscribed via atomic selectors to eliminate unnecessary component re-renders.\n\n"
        "2. Rich Markdown Enhancements:\n"
        "Rendered with custom components for alternating zebra-striped tables with sticky headers, task lists with styled interactive checkboxes, "
        "KaTeX mathematical expressions, and Mermaid architectural diagrams.\n\n"
        "3. System Prompt UK English Rules:\n"
        "Injected across all provider prompts: standard UK spellings (colour, organise, analyse, favour), eliminating em dashes in prose, "
        "and favoring short, direct clauses with commas, semicolons, or colons.\n\n"
        "4. Code-Safe Punctuation Normaliser (normalisePunctuation):\n"
        "Post-processing AI output requires extreme caution so that source code is never mutated. The normaliser parses markdown into fenced code blocks "
        "(```...```), inline code spans (`...`), HTML tags, and prose segments. Em dashes (—) and spaced en dashes ( – ) are replaced with commas or hyphens "
        "strictly in prose segments. Fenced code, CLI flags (--option), language constructs (x--), and numeric ranges (1999–2005) remain 100% immutable.",
        "Typography & Natural Language Normalization"
    )

    add_qa(
        "Explain Ty-Code's local-first security sandbox and permission tiers.",
        "To allow agents to work autonomously without risking system damage, Ty-Code uses three security layers:\n\n"
        "1. Terminal Execution Policy:\n"
        "   • Always Ask: The agent pauses and asks for user approval before running any command.\n"
        "   • Restricted Mode: Safe inspection commands (ls, cat, git status) run automatically. Dangerous commands (rm, npm install, curl) require approval.\n"
        "   • Always Proceed: Autonomous execution mode for sandboxed testing.\n\n"
        "2. Workspace Containment Sandbox: File operations (read, write, edit) are restricted to the open workspace folder. Directory traversal attempts "
        "are blocked in the main process unless the user explicitly enables System Access in Global Settings.\n\n"
        "3. Safe Edit Review Gate: Any edit modifying more than 5 lines triggers an interactive Monaco visual diff review before changing files on disk.",
        "Application Security"
    )

    add_qa(
        "How are API keys and credentials protected at rest on the client machine?",
        "Storing API keys in plain text files (.env or JSON) creates serious security vulnerabilities. Ty-Code integrates Electron's native safeStorage API:\n\n"
        "• Windows: Encrypted with Windows DPAPI (Data Protection API) tied to the OS user account.\n"
        "• macOS: Encrypted with Apple Keychain Services.\n"
        "• Linux: Encrypted using the Secret Service API (GNOME Keyring or KWallet).\n\n"
        "Keys are stored on disk as encrypted binary buffers. They are decrypted only in memory within the Main process when making HTTPS requests. "
        "The Renderer process receives only masked previews (for example, 'sk-ant-...1234') and never handles plaintext keys.",
        "Credential Cryptography"
    )

    add_qa(
        "How is Inter-Process Communication designed to prevent memory leaks?",
        "1. Process Isolation: nodeIntegration is set to false, and contextIsolation is set to true.\n"
        "2. Typed contextBridge: The preload script exposes a locked window.electronAPI interface. Renderer code cannot access raw Node modules.\n"
        "3. Disposable Listener Pattern: Every stream listener returns an explicit cleanup function. React components run this cleanup during "
        "unmounting. This prevents detached DOM nodes and listener memory leaks.\n"
        "4. Zod Schema Validation: All parameters crossing the IPC bridge are verified with Zod schemas to reject invalid payloads.",
        "IPC Architecture"
    )

    add_qa(
        "How does the Multi-Window Architecture work for the M3E UI Sketcher Canvas?",
        "The M3E UI Sketcher needed an open visual canvas that would take too much space inside the main editor.\n\n"
        "In src/main/index.ts, the openSketcherWindow() function manages a secondary BrowserWindow. It loads the application bundle with a '#sketcher' hash route.\n\n"
        "Window controls (minimize, maximize, close) are custom styled for consistency. They send IPC commands targeting the specific window instance using "
        "BrowserWindow.fromWebContents(event.sender).\n\n"
        "State synchronization between the editor and canvas runs through an IPC event bus (canvasSyncManager). This enables real-time visual UI generation from chat prompts.",
        "Window Management"
    )

    add_qa(
        "What is the Context Window Auto-Compaction strategy?",
        "In long multi-step coding workflows, token accumulation can quickly exceed model context limits or create high costs.\n\n"
        "Ty-Code tracks the token ratio against the model limit. When usage reaches 95% capacity, the agent executes an Auto-Compaction pass:\n\n"
        "1. The original system prompt and project requirements remain permanently pinned.\n"
        "2. Intermediate file outputs and test logs are condensed into a compact semantic summary.\n"
        "3. The last 2 conversation turns are kept intact for ongoing context.\n\n"
        "This recovers roughly 65% of the token budget while keeping the agent fully informed.",
        "Context Management"
    )

    # -------------------------------------------------------------
    # SECTION 4: SYSTEM DESIGN AND SCALABILITY
    # -------------------------------------------------------------
    add_h1("4. System Design and Scalability Interview Questions")

    add_qa(
        "How would you scale Ty-Code across an Enterprise Organization of 1,000+ developers?",
        "Scaling Ty-Code across an enterprise relies on four clear pillars:\n\n"
        "1. Centralized Policy Distribution: Distribute standardized enterprise policy files enforcing Restricted Mode terminal policies, "
        "restricting file access strictly to workspace folders, and disabling telemetry.\n\n"
        "2. Private LLM Gateway Integration: Point client installations to an internal corporate proxy (such as a vLLM or LiteLLM cluster) inside the private cloud. "
        "The proxy manages corporate billing and audits, while Ty-Code connects via standard endpoints.\n\n"
        "3. Air-Gapped Binary Distribution: Support internal package repositories and offline auto-update channels for secure workstations.\n\n"
        "4. Audit Logging: Save all terminal executions and file changes to a local, tamper-evident log for compliance reviews.",
        "Enterprise Architecture"
    )

    add_qa(
        "How do you guarantee zero telemetry leakage and client privacy?",
        "Ty-Code enforces a strict Zero-Telemetry policy:\n\n"
        "1. No Silent Tracking: Outbound telemetry is disabled by default. If enabled for local diagnostics, events are stored strictly "
        "in an encrypted local file on the user's machine.\n\n"
        "2. Telemetry Inspector: Users can review every stored diagnostic event in the Privacy tab. No destination URL is configured in the codebase, "
        "so nothing is transmitted externally.\n\n"
        "3. Continuous CI Guard Rails: Automated scripts run on every pull request. They verify that no tracking pixels, analytics packages, "
        "or unencrypted credentials exist in the codebase.",
        "Privacy and Compliance"
    )

    # -------------------------------------------------------------
    # SECTION 5: REAL-WORLD USE CASES TABLE
    # -------------------------------------------------------------
    add_h1("5. Real-World Use Case Scenarios and Business Impact")
    
    table = doc.add_table(rows=1, cols=3)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    
    headers = ["Enterprise Scenario", "Ty-Code Architectural Capability", "Tangible Business Value"]
    col_widths = [Inches(1.8), Inches(2.5), Inches(2.2)]
    
    hdr_cells = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr_cells[i].width = col_widths[i]
        set_cell_background(hdr_cells[i], "1E293B")
        set_cell_margins(hdr_cells[i], top=120, bottom=120, left=140, right=140)
        p = hdr_cells[i].paragraphs[0]
        r = p.add_run(h)
        r.bold = True
        r.font.name = "Segoe UI"
        r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    use_cases = [
        (
            "Regulated Environments (Healthcare, Defense, Banking)",
            "Local Ollama or vLLM integration, safeStorage encryption, and Zero-Telemetry guarantee.",
            "Enables AI coding assistance in air-gapped environments where proprietary code cannot leave the local network."
        ),
        (
            "Cost-Sensitive Startups and Students",
            "One-Click Free Mode routing through OpenKilo (40+ models) and the FCC proxy layer.",
            "Removes subscription barriers ($20 to $40 per user monthly), providing complete agent capabilities at zero cost."
        ),
        (
            "Multi-Cloud Reliability",
            "Unified ProviderGateway with dynamic fallback across OpenRouter, Groq, Anthropic, and Gemini.",
            "Prevents developer downtime during outages by automatically switching to available alternative models."
        ),
        (
            "Rapid UI Prototyping",
            "Standalone M3E Canvas Window with React Flow and bidirectional chat synchronization.",
            "Accelerates design-to-code workflows by converting visual layouts directly into production React and Tailwind code."
        ),
        (
            "Multi-Language Monorepo Development",
            "Native Language Server Protocol client supporting TypeScript, Python, Rust, and Go.",
            "Delivers compiler-grade diagnostics and code completions inside Monaco without heavy third-party IDE setups."
        )
    ]

    for row_idx, (scen, cap, val) in enumerate(use_cases):
        row = table.add_row()
        cells = row.cells
        bg_color = "F8FAFC" if row_idx % 2 == 0 else "FFFFFF"
        for i, text in enumerate([scen, cap, val]):
            cells[i].width = col_widths[i]
            set_cell_background(cells[i], bg_color)
            set_cell_margins(cells[i], top=100, bottom=100, left=140, right=140)
            p = cells[i].paragraphs[0]
            p.paragraph_format.line_spacing = 1.15
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run(text)
            r.font.name = "Calibri"
            r.font.size = Pt(9.5)
            r.font.color.rgb = RGBColor(0x33, 0x41, 0x55)

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # -------------------------------------------------------------
    # SECTION 6: ENGINEERING HURDLES SOLVED
    # -------------------------------------------------------------
    add_h1("6. Engineering Gotchas and Hard Problems Solved")
    
    add_qa(
        "What was the most challenging technical hurdle on this project?",
        "\"The hardest technical challenge was guaranteeing real-world execution integrity across asynchronous streaming and native terminals.\n\n"
        "Many open-source AI boilerplates use mock timers, simulated delays, or fake streams. We took two major steps:\n\n"
        "1. Automated CI Guard Suite: Scripts run in CI to scan code syntax trees. They block any hardcoded replies or fake delays in production agent paths.\n\n"
        "2. Live Connectivity Tracer: We built a runtime tracer that measures real round-trip latencies across every hop (Renderer -> IPC Bridge -> Gateway -> Agent Loop -> Network Provider). "
        "It provides live latency data and error reporting directly to the developer.\n\n"
        "In addition, building cross-platform terminal support with node-pty required custom native bindings to bridge Windows ConPTY and Unix pseudo-terminals cleanly.\"",
        "Technical Challenge and Ground Truth"
    )

    add_qa(
        "Why is programmatic smooth scrolling dangerous during high-speed AI streaming?",
        "\"A critical engineering gotcha we resolved was smooth scrolling animation queueing.\n\n"
        "When an AI model streams at 150 to 300+ tokens per second, token buffer commits occur every 20 to 24ms. "
        "If the scroll container uses CSS 'scroll-behavior: smooth' or if code calls el.scrollTo({ behavior: 'smooth' }), "
        "the browser's layout engine attempts to interpolate between dozens of rapid height updates. "
        "These smooth scroll animations queue up in the compositor, creating severe frame drops, visual rubber-banding, "
        "and detached scroll states where the viewport lags far behind the live token stream.\n\n"
        "We solved this by strictly enforcing behavior: 'auto' (instantaneous assignment) during all streaming flushes, "
        "setting .chat-feed { scroll-behavior: auto; }, and reserving smooth scrolling solely for discrete, user-initiated actions "
        "(such as clicking the 'Jump to latest' pill or submitting a new message).\"",
        "DOM Animation Queueing & Compositor Performance"
    )

    # -------------------------------------------------------------
    # SECTION 7: INTERVIEW CHEAT SHEET
    # -------------------------------------------------------------
    add_h1("7. Interview Quick-Reference Cheat Sheet")
    
    cheat_items = [
        ("Architecture Pattern", "Multi-Process Electron Architecture (Main, Preload, Renderer) with strict Process Isolation and contextBridge."),
        ("Design Patterns Used", "Adapter Pattern (ProviderGateway), ReAct Loop (Agent Engine), Observer and Disposable Pattern (IPC Streaming), Atomic Selector Subscriptions (Zustand), Self-Cancelling Animation Loop (ScrambleText)."),
        ("Key Protocols", "Server-Sent Events (SSE), JSON-RPC 2.0 (Language Server Protocol), ANSI escape sequences (XTerm.js and node-pty), Electron IPC, HTTPS keepAlive connection pooling."),
        ("Security Standards", "OS safeStorage (DPAPI, Keychain, libsecret), Three-Tier Terminal Sandbox (Always Ask, Restricted, Always Proceed), Workspace Path Traversal Containment."),
        ("Performance Optimizations", "Main Process token coalescing (16–24ms) with immediate Chunk #1 flush (0ms TTFT); Double-buffered 24ms rAF renderer flush; Smart sticky-scroll auto-follow with <64px pin detection and zero-per-pixel re-renders; ResizeObserver height-jump isolation; Bounded 200-char Matrix Decode glyph scramble; CSS content-visibility: auto layout virtualization; Per-host HTTPS keepAlive socket reuse; Token auto-compaction at 95% threshold; Monaco Diff review gating."),
        ("Typography & Text Processing", "Modular Zustand typography system (System Sans, Georgia Serif, JetBrains Mono, IBM Plex Mono); Code-safe UK English punctuation AST normaliser protecting fenced code blocks, inline spans, and CLI syntax.")
    ]

    for term, definition in cheat_items:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.2)
        p.paragraph_format.space_after = Pt(4)
        run_term = p.add_run(f"• {term}: ")
        run_term.bold = True
        run_term.font.name = "Calibri"
        run_term.font.color.rgb = RGBColor(0x4F, 0x46, 0xE5)
        run_def = p.add_run(definition)
        run_def.font.name = "Calibri"
        run_def.font.color.rgb = RGBColor(0x33, 0x41, 0x55)

    doc.save(output_path)
    print(f"Successfully generated clean Word document: {output_path}")

def convert_docx_to_pdf(docx_path, pdf_path):
    try:
        import win32com.client
        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False
        abs_docx = os.path.abspath(docx_path)
        abs_pdf = os.path.abspath(pdf_path)
        doc = word.Documents.Open(abs_docx)
        doc.SaveAs(abs_pdf, FileFormat=17) # 17 = wdFormatPDF
        doc.Close()
        word.Quit()
        print(f"Successfully generated clean PDF document: {pdf_path}")
        return True
    except Exception as e:
        print(f"Word automation PDF generation failed: {e}")
        return False

if __name__ == "__main__":
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "Ty-Code_Architecture_and_Interview_Guide.docx")
    create_interview_doc(out)
    pdf_out = os.path.splitext(out)[0] + ".pdf"
    convert_docx_to_pdf(out, pdf_out)
