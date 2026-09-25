import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { CreditValue } from './CreditValue';
import { useCreditChanges } from '../hooks/useCreditChanges';
import { formatTokens } from '../lib/format';
import type { AgentTraceSelection, ConversationSummary } from '../../shared/types';

export interface ConversationsTableProps {
  conversations: ConversationSummary[];
  updateContextKey: string;
  onViewTrace(selection: AgentTraceSelection): void;
}

const CREDIT_DELTA_DURATION_MS = 1_500;
const SOURCE_LABELS: Record<ConversationSummary['source'], string> = {
  vscode: 'VS Code',
  'copilot-cli': 'Copilot CLI',
};

// Keeps the visible label first so each row's action has a distinct accessible name.
function describeTraceAction(conversation: ConversationSummary): string {
  const summary = conversation.summary ?? 'conversation sans résumé';
  return `Voir la trace : ${summary} — ${SOURCE_LABELS[conversation.source]}, ${conversation.createdAt}`;
}

export function ConversationsTable({
  conversations,
  updateContextKey,
  onViewTrace,
}: ConversationsTableProps) {
  const getConversationKey = (conversation: ConversationSummary) =>
    `${conversation.source}:${conversation.sessionId}`;

  const changes = useCreditChanges(
    conversations,
    conversations.map((conversation) => ({
      key: getConversationKey(conversation),
      value: conversation.aiuCredits,
    })),
    updateContextKey,
    CREDIT_DELTA_DURATION_MS,
  );

  if (conversations.length === 0) {
    return <p className="text-sm text-muted-foreground">No conversations for this selection.</p>;
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Model(s)</TableHead>
              <TableHead>AIU credits</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Requests</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conversations.map((conversation) => (
              <TableRow key={getConversationKey(conversation)}>
                <TableCell>{conversation.createdAt}</TableCell>
                <TableCell>{conversation.summary ?? '—'}</TableCell>
                <TableCell>{conversation.models}</TableCell>
                <TableCell>
                  <CreditValue
                    value={conversation.aiuCredits}
                    change={changes.get(getConversationKey(conversation))}
                  />
                </TableCell>
                <TableCell>{formatTokens(conversation.tokens)}</TableCell>
                <TableCell>{conversation.requests}</TableCell>
                <TableCell>
                  <button
                    type="button"
                    aria-label={describeTraceAction(conversation)}
                    onClick={() =>
                      onViewTrace({
                        source: conversation.source,
                        sessionId: conversation.sessionId,
                      })
                    }
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                  >
                    Voir la trace
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
