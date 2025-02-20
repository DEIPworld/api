// Copyright 2017-2021 @polkadot/api-derive authors & contributors
// SPDX-License-Identifier: Apache-2.0

import type { Observable } from 'rxjs';
import type { ApiInterfaceRx } from '@polkadot/api/types';
import type { EraIndex, EraRewardPoints } from '@polkadot/types/interfaces';
import type { DeriveEraPoints, DeriveEraValPoints } from '../types';

import { map, of, switchMap } from 'rxjs';

import { BN_ZERO } from '@polkadot/util';

import { deriveCache, memo } from '../util';
import { filterEras } from './util';

const CACHE_KEY = 'eraPoints';

function mapValidators ({ individual }: EraRewardPoints): DeriveEraValPoints {
  return [...individual.entries()]
    .filter(([, points]) => points.gt(BN_ZERO))
    .reduce((result: DeriveEraValPoints, [validatorId, points]): DeriveEraValPoints => {
      result[validatorId.toString()] = points;

      return result;
    }, {});
}

function mapPoints (eras: EraIndex[], points: EraRewardPoints[]): DeriveEraPoints[] {
  return eras.map((era, index): DeriveEraPoints => ({
    era,
    eraPoints: points[index].total,
    validators: mapValidators(points[index])
  }));
}

export function _erasPoints (instanceId: string, api: ApiInterfaceRx): (eras: EraIndex[], withActive: boolean) => Observable<DeriveEraPoints[]> {
  return memo(instanceId, (eras: EraIndex[], withActive: boolean): Observable<DeriveEraPoints[]> => {
    if (!eras.length) {
      return of([]);
    }

    const cached: DeriveEraPoints[] = withActive
      ? []
      : eras
        .map((era) => deriveCache.get<DeriveEraPoints>(`${CACHE_KEY}-${era.toString()}`))
        .filter((value): value is DeriveEraPoints => !!value);
    const remaining = filterEras(eras, cached);

    return !remaining.length
      ? of(cached)
      : api.query.staking.erasRewardPoints.multi(remaining).pipe(
        map((points): DeriveEraPoints[] => {
          const query = mapPoints(remaining, points);

          !withActive && query.forEach((q) => deriveCache.set(`${CACHE_KEY}-${q.era.toString()}`, q));

          return eras.map((era): DeriveEraPoints =>
            cached.find((cached) => era.eq(cached.era)) ||
            query.find((query) => era.eq(query.era)) as DeriveEraPoints
          );
        })
      );
  });
}

export function erasPoints (instanceId: string, api: ApiInterfaceRx): (withActive?: boolean) => Observable<DeriveEraPoints[]> {
  return memo(instanceId, (withActive = false): Observable<DeriveEraPoints[]> =>
    api.derive.staking.erasHistoric(withActive).pipe(
      switchMap((eras) => api.derive.staking._erasPoints(eras, withActive))
    )
  );
}
