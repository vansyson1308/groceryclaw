export type TenantId = string & { readonly __brand: 'TenantId' };
export type ZaloPlatformUserId = string & { readonly __brand: 'ZaloPlatformUserId' };
export type ZaloUserId = string & { readonly __brand: 'ZaloUserId' };
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };

export type RuntimeEnvironment = 'development' | 'test' | 'production';

export interface ServiceIdentity {
  readonly service: 'gateway' | 'admin' | 'worker';
  readonly env: RuntimeEnvironment;
}
