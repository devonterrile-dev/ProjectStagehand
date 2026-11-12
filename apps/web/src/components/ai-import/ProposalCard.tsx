import {
  RECORD_TYPE_LABELS,
  type ImportProposal,
  type PatchProposalRequest,
  type ProposalReviewState,
} from '@stagehand/shared';
import { CheckIcon, PencilIcon, RotateCcwIcon, Undo2Icon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { isAccepted, REVIEW_STATE_LABELS } from '@/lib/ai-import';
import { usePatchProposal } from '@/lib/queries';

import { CreateProposalEditor, LinkProposalEditor, UpdateProposalEditor } from './ProposalEditors';
import { RefChip } from './ProposalParts';
import { CreateProposalView, LinkProposalView, UpdateProposalView } from './ProposalViews';
import { useReview } from './review-context';

const STATE_VARIANT: Record<ProposalReviewState, 'default' | 'secondary' | 'outline'> = {
  pending: 'outline',
  accepted: 'default',
  edited: 'default',
  rejected: 'secondary',
};

/** "New NPC", "Change to Area", "Link". */
function kindOf(proposal: ImportProposal): string {
  switch (proposal.action) {
    case 'create':
      return `New ${RECORD_TYPE_LABELS[proposal.payload.type]}`;
    case 'update':
      return `Change to ${RECORD_TYPE_LABELS[proposal.payload.type]}`;
    case 'link':
      return 'Link';
  }
}

/** The card's accessible name and heading. */
function titleOf(proposal: ImportProposal, refName: (id: string) => string): string {
  switch (proposal.action) {
    case 'create':
      return proposal.payload.name;
    case 'update':
      return proposal.before?.name ?? refName(proposal.payload.recordId);
    case 'link':
      return `${refName(proposal.payload.fromId)} → ${refName(proposal.payload.toId)}`;
  }
}

/**
 * One proposal on the review screen (§10 step 5): what it would do, its review state, and
 * Accept, Reject, Edit (saving an edit accepts it, as `edited`), Undo and Restore original.
 */
export function ProposalCard({ proposal }: { proposal: ImportProposal }) {
  const { campaignId, importId, refs, readOnly } = useReview();
  const patch = usePatchProposal(campaignId, importId);
  const [editing, setEditing] = useState(false);
  const refName = (id: string) => refs[id]?.name ?? 'Deleted record';
  const title = titleOf(proposal, refName);
  const state = proposal.reviewState;
  const editable = proposal.action !== 'link' || proposal.payload.fieldKey === null;
  const busy = patch.isPending;

  const send = (body: PatchProposalRequest, then?: () => void) => {
    patch.mutate({ proposalId: proposal.id, patch: body }, { onSuccess: then });
  };
  const save = (payload: unknown) => {
    send({ payload, reviewState: 'accepted' }, () => {
      setEditing(false);
    });
  };
  const cancel = () => {
    setEditing(false);
    patch.reset();
  };

  return (
    <Card
      role="article"
      aria-label={`${kindOf(proposal)}: ${title}`}
      className={state === 'rejected' ? 'opacity-60' : ''}
    >
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {kindOf(proposal)}
          </p>
          {proposal.action === 'create' && <h3 className="text-lg font-semibold">{title}</h3>}
          {proposal.action === 'update' && (
            <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              <RefChip id={proposal.payload.recordId} />
              {(proposal.before?.revealedAt ?? null) !== null && (
                <Badge variant="destructive">Revealed to players</Badge>
              )}
            </h3>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATE_VARIANT[state]}>{REVIEW_STATE_LABELS[state]}</Badge>
          {!readOnly && !editing && (
            <>
              {!isAccepted(state) && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    send({ reviewState: 'accepted' });
                  }}
                >
                  <CheckIcon aria-hidden />
                  Accept
                </Button>
              )}
              {state !== 'rejected' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    send({ reviewState: 'rejected' });
                  }}
                >
                  <XIcon aria-hidden />
                  Reject
                </Button>
              )}
              {editable && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    patch.reset();
                    setEditing(true);
                  }}
                >
                  <PencilIcon aria-hidden />
                  Edit
                </Button>
              )}
              {state !== 'pending' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    send({ reviewState: 'pending' });
                  }}
                >
                  <Undo2Icon aria-hidden />
                  Undo
                </Button>
              )}
              {proposal.original !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    send({ payload: proposal.original });
                  }}
                >
                  <RotateCcwIcon aria-hidden />
                  Restore original
                </Button>
              )}
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {patch.isError && (
          <p role="alert" className="text-sm text-destructive">
            {patch.error.message}
          </p>
        )}
        {editing ? (
          <ProposalEditor proposal={proposal} saving={busy} onSave={save} onCancel={cancel} />
        ) : proposal.action === 'create' ? (
          <CreateProposalView proposal={proposal} />
        ) : proposal.action === 'update' ? (
          <UpdateProposalView proposal={proposal} />
        ) : (
          <LinkProposalView proposal={proposal} />
        )}
      </CardContent>
    </Card>
  );
}

function ProposalEditor({
  proposal,
  saving,
  onSave,
  onCancel,
}: {
  proposal: ImportProposal;
  saving: boolean;
  onSave: (payload: unknown) => void;
  onCancel: () => void;
}) {
  const props = { saving, onSave, onCancel };
  switch (proposal.action) {
    case 'create':
      return <CreateProposalEditor proposal={proposal} {...props} />;
    case 'update':
      return <UpdateProposalEditor proposal={proposal} {...props} />;
    case 'link':
      return <LinkProposalEditor proposal={proposal} {...props} />;
  }
}
