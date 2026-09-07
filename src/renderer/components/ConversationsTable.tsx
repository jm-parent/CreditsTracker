import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import type { ConversationSummary } from '../../shared/types';

interface ConversationsTableProps {
  conversations: ConversationSummary[];
}

export function ConversationsTable({ conversations }: ConversationsTableProps) {
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
                <TableCell>{conversation.aiuCredits.toFixed(2)}</TableCell>
                <TableCell>{conversation.tokens}</TableCell>
                <TableCell>{conversation.requests}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
