export type EaseeAccessTokenResponse = {
  accessToken?: string;
  expiresIn?: number;
};

export type EaseeCharger = {
  id?: string;
  chargerId?: string;
  serialNumber?: string;
  name?: string;
  status?: string;
  isOnline?: boolean;
  siteId?: string;
};

export type EaseeSite = {
  id?: string;
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
};
