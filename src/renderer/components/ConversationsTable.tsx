import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { CreditValue } from './CreditValue';
import { useCreditChanges } from '../hooks/useCreditChanges';
import { formatTokens } from '../lib/format';
import type { ConversationSummary } from '../../shared/types';

interface ConversationsTableProps {
  conversations: ConversationSummary[];
  updateContextKey: string;
}

const CREDIT_DELTA_DURATION_MS = 1_500;

export function ConversationsTable({ conversations, updateContextKey }: ConversationsTableProps) {
  const changes = useCreditChanges(
    conversations,
    conversations.map((conversation) => ({ key: conversation.sessionId, value: conversation.aiuCredits })),
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {conversations.map((conversation) => (
              <TableRow key={conversation.sessionId}>
                <TableCell>{conversation.createdAt}</TableCell>
                <TableCell>{conversation.summary ?? '—'}</TableCell>
                <TableCell>{conversation.models}</TableCell>
                <TableCell>
                  <CreditValue value={conversation.aiuCredits} change={changes.get(conversation.sessionId)} />
                </TableCell>
                <TableCell>{formatTokens(conversation.tokens)}</TableCell>
                <TableCell>{conversation.requests}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
