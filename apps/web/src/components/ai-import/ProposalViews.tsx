import { TriangleAlertIcon } from 'lucide-react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import {
  changedFieldSpecs,
  isBlank,
  linkKindLabel,
  specsOf,
  type CreateProposal,
  type LinkProposal,
  type UpdateProposal,
} from '@/lib/ai-import';
import { recordPath } from '@/lib/records';

import { Diff, FieldValue, Part, RefChip, RichValue } from './ProposalParts';
import { useReview } from './review-context';

/** A new record, as it would be saved. */
export function CreateProposalView({ proposal }: { proposal: CreateProposal }) {
  const { campaignId } = useReview();
  const { payload, possibleDuplicates } = proposal;
  return (
    <div className="space-y-4">
      {possibleDuplicates.length > 0 && (
        <p
          role="note"
          className="flex flex-wrap items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
        >
          <TriangleAlertIcon className="size-4" aria-hidden />
          Possible duplicate of{' '}
          {possibleDuplicates.map((duplicate, index) => (
            <span key={duplicate.id}>
              {index > 0 && ', '}
              <Link
                to={recordPath(campaignId, duplicate.id)}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                {duplicate.name}
              </Link>
            </span>
          ))}
          . Reject this one, or rename it, if it is the same.
        </p>
      )}
      {payload.parentId !== null && (
        <Part label="Area">
          <RefChip id={payload.parentId} />
        </Part>
      )}
      {payload.tags.length > 0 && (
        <Part label="Tags">
          <div className="flex flex-wrap gap-1">
            {payload.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        </Part>
      )}
      {!isBlank(payload.publicDescription) && (
        <Part label="Public description">
          <RichValue value={payload.publicDescription} />
        </Part>
      )}
      {specsOf(payload.type).map(([key, spec]) => {
        if (spec.kind === 'links') {
          const ids = payload.links[key] ?? [];
          if (ids.length === 0) return null;
          return (
            <Part key={key} label={spec.label}>
              <div className="flex flex-wrap gap-1">
                {ids.map((id) => (
                  <RefChip key={id} id={id} />
                ))}
              </div>
            </Part>
          );
        }
        const value = payload.fields[key];
        if (isBlank(value)) return null;
        return (
          <Part key={key} label={spec.label}>
            <FieldValue spec={spec} value={value} />
          </Part>
        );
      })}
      {!isBlank(payload.gmNotes) && (
        <Part label="GM notes">
          <RichValue value={payload.gmNotes} />
        </Part>
      )}
      {payload.otherLinks.length > 0 && (
        <Part label="Other links">
          <div className="flex flex-wrap gap-1">
            {payload.otherLinks.map((link) => (
              <RefChip key={link.recordId} id={link.recordId} suffix={link.label} />
            ))}
          </div>
        </Part>
      )}
    </div>
  );
}

/** "Adds tags": the tags the record has, then the new ones. */
function TagList({ tags, emphasis = false }: { tags: readonly string[]; emphasis?: boolean }) {
  if (tags.length === 0) return <span className="text-muted-foreground italic">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant={emphasis ? 'default' : 'outline'}>
          {tag}
        </Badge>
      ))}
    </div>
  );
}

/** A change to an existing record, field by field against the record as it is now. */
export function UpdateProposalView({ proposal }: { proposal: UpdateProposal }) {
  const { payload, before } = proposal;
  if (before === null) {
    return (
      <p className="text-sm text-muted-foreground">
        This record was deleted after Claude proposed the change, so it will be skipped.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {payload.name !== undefined && (
        <Diff label="Name" before={before.name} after={payload.name} />
      )}
      {payload.publicDescription !== undefined && (
        <Diff
          label="Public description"
          before={<RichValue value={before.publicDescription} />}
          after={<RichValue value={payload.publicDescription} />}
        />
      )}
      {changedFieldSpecs(proposal).map(([key, spec]) => (
        <Diff
          key={key}
          label={spec.label}
          before={<FieldValue spec={spec} value={before.fields[key]} />}
          after={<FieldValue spec={spec} value={payload.fields?.[key]} />}
        />
      ))}
      {payload.gmNotes !== undefined && (
        <Diff
          label="GM notes"
          before={<RichValue value={before.gmNotes} />}
          after={<RichValue value={payload.gmNotes} />}
        />
      )}
      {payload.addTags !== undefined && payload.addTags.length > 0 && (
        <Diff
          label="Tags"
          before={<TagList tags={before.tags} />}
          after={
            <div className="space-y-1">
              <TagList tags={payload.addTags} emphasis />
              <p className="text-xs text-muted-foreground">Added; no tag is removed.</p>
            </div>
          }
        />
      )}
    </div>
  );
}

/** A link from an existing record, to an existing or a proposed one. */
export function LinkProposalView({ proposal }: { proposal: LinkProposal }) {
  const { payload, replaces } = proposal;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <RefChip id={payload.fromId} />
        <span className="text-muted-foreground">{linkKindLabel(payload)} →</span>
        <RefChip id={payload.toId} />
      </div>
      {replaces !== null && (
        <p className="text-muted-foreground">
          Replaces <span className="font-medium text-foreground">{replaces.name}</span>, since{' '}
          {linkKindLabel(payload)} holds one record.
        </p>
      )}
    </div>
  );
}
