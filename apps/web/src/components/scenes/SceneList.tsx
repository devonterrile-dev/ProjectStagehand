import type { SceneSummary } from '@stagehand/shared';
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { scenePath } from '@/lib/scenes';

interface SceneListProps {
  campaignId: string;
  scenes: SceneSummary[];
  /** False while the campaign is archived: no renaming or deleting. */
  editable: boolean;
  onRename: (scene: SceneSummary) => void;
  onDelete: (scene: SceneSummary) => void;
}

const placed = (count: number) => (count === 0 ? 'nothing placed' : `${String(count)} placed`);

/** The campaign's scenes (F3.2); each opens in the scene builder. */
export function SceneList({ campaignId, scenes, editable, onRename, onDelete }: SceneListProps) {
  if (scenes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No scenes yet. Create one with New scene, or with Build a scene here on a Spot.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-md border" aria-label="Scenes">
      {scenes.map((scene) => (
        <li key={scene.id} className="flex items-center gap-2 pr-2 hover:bg-muted">
          <Link
            to={scenePath(campaignId, scene.id)}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
          >
            <span className="font-medium">{scene.name}</span>
            {scene.type === 'transition' && <Badge variant="outline">Transition</Badge>}
            <span className="text-sm text-muted-foreground">
              {scene.spot === null ? 'No backdrop' : scene.spot.name}
            </span>
            <span className="text-sm text-muted-foreground">{placed(scene.objectCount)}</span>
          </Link>
          {editable && (
            // Non-modal so the dialog it opens can take focus cleanly.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Options for ${scene.name}`}>
                  <MoreHorizontalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    onRename(scene);
                  }}
                >
                  <PencilIcon aria-hidden />
                  Rename…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    onDelete(scene);
                  }}
                >
                  <Trash2Icon aria-hidden />
                  Delete…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </li>
      ))}
    </ul>
  );
}
