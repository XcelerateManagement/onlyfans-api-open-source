import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Helper function to format role names for display
export function formatRoleName(role: string): string {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'manager':
      return 'Manager';
    case 'employee':
      return 'Employee';
    case 'hr':
      return 'HR Manager';
    case 'ig_manager':
      return 'IG Manager';
    case 'model_manager':
      return 'Model Manager';
    case 'model':
      return 'Model';
    default:
      return role || 'Model';
  }
}

/**
 * Get the base URL from request headers (supports reverse proxy)
 * Checks X-Forwarded-Proto, X-Forwarded-Host, and Host headers
 */
export function getBaseUrl(req?: Request | { headers: Headers | any }): string {
  // For client-side
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  // For server-side with request
  if (req) {
    const headers = req.headers instanceof Headers ? req.headers : new Headers(req.headers);

    // Check for reverse proxy headers (nginx, apache, etc.)
    const forwardedProto = headers.get('x-forwarded-proto') || 'https';
    const forwardedHost = headers.get('x-forwarded-host') || headers.get('host');

    if (forwardedHost) {
      return `${forwardedProto}://${forwardedHost}`;
    }
  }

  // Fallback to environment variable
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

/**
 * Build an absolute URL from a path
 */
export function getAbsoluteUrl(path: string, req?: Request | { headers: Headers | any }): string {
  const baseUrl = getBaseUrl(req);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
}
