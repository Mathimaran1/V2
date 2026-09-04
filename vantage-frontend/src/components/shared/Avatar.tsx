import { getAvatarColor, getInitials } from '@/services/utils';

interface AvatarProps {
  name: string;
  avatarUrl?: string;
  size?: number;
}

export default function Avatar({ name, avatarUrl, size = 32 }: AvatarProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="avatar"
        style={{ width: size, height: size, borderRadius: '50%' }}
      />
    );
  }

  return (
    <div
      className="avatar avatar-initials"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: getAvatarColor(name),
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 600,
        flexShrink: 0,
      }}
      aria-label={name}
    >
      {getInitials(name)}
    </div>
  );
}
