import {it,expect} from 'vitest';
import {stepCost} from './cost-summary';
it('uses spendable and adds margin-inclusive fee exactly once',()=>{expect(stepCost(12n,20n,31n)).toEqual({required:32n,affordable:false});expect(stepCost(12n,20n,32n).affordable).toBe(true);});
