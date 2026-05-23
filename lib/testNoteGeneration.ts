import { generateSmartNote } from './generateSmartNote';

async function test() {
  const result = await generateSmartNote({
    sessionInfo: {
      date: '2026-05-22',
      timeRange: '9:00 AM - 11:00 AM',
      location: '2931 NW 51st Ave, Miami FL',
      caregiver: 'mother',
      rbtName: 'RBT'
    },
    clientId: '30000000-0000-0000-0000-000000000001',
    behaviorsObserved: [
      {
        name: 'Tantrum',
        topography: 'screamed and yelled with facial contractions and abrupt body movements',
        frequency: 4,
        antecedentContext: 'denial of access to tablet during structured activity',
        function: 'tangible'
      },
      {
        name: 'Physical Aggression',
        topography: 'hit caregiver with open hand',
        frequency: 2,
        antecedentContext: 'transition from preferred activity to non-preferred task',
        function: 'escape'
      },
      {
        name: 'Property Destruction',
        topography: 'swept materials off the table onto the floor',
        frequency: 3,
        antecedentContext: 'presented with worksheet during academic demand',
        function: 'escape'
      }
    ],
    replacementSkillsAddressed: [
      {
        name: 'Request a Break Properly',
        promptLevel: 'verbal prompt',
        clientResponse: 'client said break and waited 2 minutes before returning to task',
        successful: true
      },
      {
        name: 'Properly Request Activities or Tangibles',
        promptLevel: 'gestural prompt',
        clientResponse: 'client pointed to tablet and said please',
        successful: true
      }
    ],
    activitiesUsed: [
      { name: 'Lego building', preferred: true },
      { name: 'worksheet completion', preferred: false },
      { name: 'tablet games', preferred: true },
      { name: 'coloring', preferred: false }
    ],
    reinforcersUsed: [
      { type: 'social', item: 'verbal praise', deliveredWhen: 'immediately following appropriate request' },
      { type: 'non-edible', item: 'tablet access for 3 minutes', deliveredWhen: 'contingent on task completion' },
      { type: 'social', item: 'high five', deliveredWhen: 'following successful break request' }
    ],
    clinicalEvents: 'New RBT began working with client today. Mother present throughout session and assisted with transitions.'
  });

  console.log('═══════════════════════════════════');
  console.log('GENERATED SESSION NOTE:');
  console.log('═══════════════════════════════════');
  console.log(result.note);
  console.log('═══════════════════════════════════');
  console.log('Behaviors documented:', result.behaviorsDocumented);
  console.log('Skills documented:', result.replacementSkillsDocumented);
}

test().catch(console.error);
