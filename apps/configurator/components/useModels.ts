'use client';

import { useSyncExternalStore } from 'react';
import { modelsVersion, subscribeModels } from '@/lib/modelLoader';

/** A number that changes whenever a model file arrives (or fails), so anything drawn from models can be redrawn. */
export const useModelsVersion = () => useSyncExternalStore(subscribeModels, modelsVersion, () => 0);
