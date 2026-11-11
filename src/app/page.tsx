import site from "../../assistant.config";
import { ChatWidget } from "../components/assistant/ChatWidget";

/**
 * Minimal demo shell. Replace this page with your own site; the only line that matters is <ChatWidget />.
 * The config below is read on the server and passed to the client widget as plain props.
 */
export default function Home() {
  return (
    <main className="shell">
      <p className="eyebrow">portfolio-ai-assistant · sample persona</p>
      <h1>Arlo Quill</h1>
      <p className="lede">
        This page is a stand-in for a personal portfolio. The chat button in the corner opens {site.assistantName}, a
        retrieval-grounded assistant that answers only from the markdown notes in <code>{site.kbDir}/</code>.
      </p>
      <ul className="tips">
        <li>Try a question from the suggestions, or ask something the notes do not cover and watch it decline.</li>
        <li>
          No API keys yet? The page and widget still load; the assistant will say that no model is configured. See
          <code> .env.example</code> and <code>docs/HOWTO.md</code>.
        </li>
        <li>Everything here, including Arlo, is fictional sample data.</li>
      </ul>
      <ChatWidget
        config={{
          assistantName: site.assistantName,
          subjectName: site.subjectName,
          greeting: site.greeting,
          starterQuestions: site.starterQuestions,
          showSources: site.showSources,
        }}
      />
    </main>
  );
}
