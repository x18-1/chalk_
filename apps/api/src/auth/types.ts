export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: 'admin' | 'user';
};

export type LoginCredentials = {
  email: string;
  password: string;
};
