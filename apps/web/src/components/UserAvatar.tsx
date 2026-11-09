import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

/** Anyone with a name and an optional Discord avatar: the signed-in user or a member. */
interface AvatarUser {
  displayName: string;
  avatarUrl: string | null;
}

export function UserAvatar({ user, className }: { user: AvatarUser; className?: string }) {
  return (
    <Avatar className={className}>
      {user.avatarUrl !== null && <AvatarImage src={user.avatarUrl} alt="" />}
      <AvatarFallback>{user.displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
