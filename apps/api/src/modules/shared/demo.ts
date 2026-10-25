/** Only the mock produces DEMO / MOCK results (S-13 D-12). */
export const isDemo = (provider: string | null): boolean => provider === 'mock';
