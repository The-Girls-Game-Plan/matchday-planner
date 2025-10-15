import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, query, getDocs, deleteDoc } from 'firebase/firestore';
import { User, Settings, Play, Save, Unlock, Loader2, Star } from 'lucide-react';

// --- CONFIGURATION & CONSTANTS ---

// Provided color palette
const COLORS = {
  NAVY_BLUE: '#193755', // Primary Text/Headers
  ORANGE: '#E97227', // Accent/CTA
  SKY_BLUE: '#56B0D5', // Secondary Accent/Players
  WHITE: '#FFFFFF',
  GOLD: '#AF9542', // Premiership/Premium features
};

// Fixed match durations based on FA guidelines (default)
const MATCH_DURATIONS = {
  '5v5': 40,
  '7v7': 50,
  '9v9': 60,
  '11v11': 70, // Base duration for older age groups, subject to manual check/override note
};


// Formations and their position mappings (Outfield only)
const FORMATIONS = {
  '5v5': {
    maxPlayers: 4,
    formations: {
      '1-2-1': ['CD', 'CM-R', 'CM-L', 'ST'],
      '2-1-1': ['CD-R', 'CD-L', 'CM', 'ST'],
      '1-1-2': ['CD', 'CM', 'ST-R', 'ST-L'],
    }
  },
  '7v7': {
    maxPlayers: 6,
    formations: {
      '2-1-3': ['CD-R', 'CD-L', 'CM', 'ST-R', 'ST-L', 'ST'],
      '2-2-2': ['CD-R', 'CD-L', 'CM-R', 'CM-L', 'ST-R', 'ST-L'],
      '1-3-2': ['CD', 'CM-R', 'CM-L', 'CM', 'ST-R', 'ST-L'],
      '2-3-1': ['CD-R', 'CD-L', 'CM-R', 'CM-L', 'CM', 'ST'],
      '1-2-3': ['CD', 'CM-R', 'CM-L', 'ST-R', 'ST-L', 'ST'],
      '1-4-1': ['CD', 'CM-R', 'CM-L', 'RW', 'LW', 'ST'],
    }
  },
  '9v9': {
    maxPlayers: 8,
    formations: {
      '3-2-3': ['CD-R', 'CD-L', 'CD', 'CM-R', 'CM-L', 'ST-R', 'ST-L', 'ST'],
      '3-3-2': ['CD-R', 'CD-L', 'CD', 'CM-R', 'CM-L', 'CDM', 'ST-R', 'ST-L'],
      '3-4-1': ['CD-R', 'CD-L', 'CD', 'RB', 'LB', 'CM', 'CDM', 'ST'],
      '3-2-1-2': ['CD-R', 'CD-L', 'CD', 'CDM-R', 'CDM-L', 'CAM', 'ST-R', 'ST-L'],
      '2-4-2': ['CD-R', 'CD-L', 'CM-R', 'CM-L', 'CDM', 'CAM', 'ST-R', 'ST-L'],
      '2-3-3': ['CD-R', 'CD-L', 'CM-R', 'CM-L', 'CDM', 'ST-R', 'ST-L', 'ST'],
      '2-2-4': ['CD-R', 'CD-L', 'CM-R', 'CM-L', 'ST-R', 'ST-L', 'RW', 'LW'],
    }
  },
  '11v11': {
    maxPlayers: 10,
    formations: {
      '4-4-2': ['RB', 'LB', 'CD-R', 'CD-L', 'RW', 'LW', 'CM-R', 'CM-L', 'ST-R', 'ST-L'],
      '4-3-3': ['RB', 'LB', 'CD-R', 'CD-L', 'CM-R', 'CM-L', 'CDM', 'RW', 'LW', 'ST'],
      '4-2-3-1': ['RB', 'LB', 'CD-R', 'CD-L', 'CDM-R', 'CDM-L', 'RW', 'LW', 'CAM', 'ST'],
      '4-1-4-1': ['RB', 'LB', 'CD-R', 'CD-L', 'CDM', 'CM-R', 'CM-L', 'RW', 'LW', 'ST'],
      '4-2-4': ['RB', 'LB', 'CD-R', 'CD-L', 'CM-R', 'CM-L', 'ST-R', 'ST-L', 'RW', 'LW'],
      '3-5-2': ['CD-R', 'CD-L', 'CD', 'CM-R', 'CM-L', 'CDM', 'CAM', 'RW', 'ST-R', 'ST-L'],
      '3-4-3': ['CD-R', 'CD-L', 'CD', 'CM-R', 'CM-L', 'CDM', 'CAM', 'RW', 'LW', 'ST'],
    }
  },
};

// All unique positions for selector
const ALL_POSITIONS = [
  'GK', 'CD', 'CD-R', 'CD-L', 'RB', 'LB', 'CM', 'CM-R', 'CM-L',
  'CDM', 'CAM', 'RW', 'LW', 'ST', 'ST-R', 'ST-L'
];

// --- UTILITY FUNCTIONS ---

/**
 * Retries a promise with exponential backoff.
 */
const retryFetch = async (apiCall, maxRetries = 5) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCall();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            const delay = Math.pow(2, i) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

/**
 * Creates a path reference for a user's private data in Firestore.
 * @param {string} collectionName - 'squads' or 'settings'.
 * @param {string} userId - The unique ID of the current user.
 * @returns {string} The full Firestore path.
 */
const getPrivatePath = (collectionName, userId) => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    // Note: For Canvas, data is namespaced by appId and userId
    return `artifacts/${appId}/users/${userId}/${collectionName}`;
};

// --- FIREBASE INITIALIZATION & AUTH HOOK ---

const useFirebase = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [error, setError] = useState(null);

  // Constants provided by the Canvas environment
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
  const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

  useEffect(() => {
    if (!firebaseConfig) {
      console.error('Firebase configuration is missing.');
      setError('Firebase setup failed: Config missing.');
      return;
    }

    try {
      // 1. Initialize Firebase
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authInstance = getAuth(app);
      setDb(firestore);
      setAuth(authInstance);

      console.log('Firebase initialized. Setting up auth listener...');

      // 2. Handle Authentication
      const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
        if (user) {
          setUserId(user.uid);
          console.log('User signed in with UID:', user.uid);
        } else {
          try {
            // Sign in with custom token or anonymously if token is missing
            if (initialAuthToken) {
              const userCredential = await signInWithCustomToken(authInstance, initialAuthToken);
              setUserId(userCredential.user.uid);
              console.log('Signed in with custom token.');
            } else {
              const userCredential = await signInAnonymously(authInstance);
              setUserId(userCredential.user.uid);
              console.log('Signed in anonymously.');
            }
          } catch (e) {
            console.error('Auth error:', e);
            setError(`Authentication failed: ${e.message}`);
          }
        }
        setIsAuthReady(true);
      });

      return () => unsubscribe();
    } catch (e) {
      console.error('Error initializing Firebase:', e);
      setError(`Firebase Initialization Error: ${e.message}`);
    }
  }, [firebaseConfig, initialAuthToken]);

  const firestorePath = useMemo(() => {
    if (userId) {
      // Path for private data
      return getPrivatePath('squads', userId);
    }
    return null;
  }, [userId]);

  return { db, auth, userId, isAuthReady, firestorePath, appId, error };
};

// --- CORE MATCH PLANNER LOGIC ---

/**
 * Calculates the equal minutes for outfield players.
 */
const calculateEqualMinutes = (settings, players) => {
  const { gameFormat, matchDuration, isPermanentGK } = settings;

  if (!matchDuration || matchDuration <= 0 || players.length === 0) return players;

  const outfieldSpots = FORMATIONS[gameFormat].maxPlayers;
  const outfieldPlayers = players.filter(p => p.role !== 'GK');
  const numOutfieldPlayers = outfieldPlayers.length;

  if (numOutfieldPlayers === 0) return players;

  // 1. Calculate Total Available Outfield Minutes
  const totalOutfieldMinutesAvailable = outfieldSpots * matchDuration;

  // 2. Calculate Equal Time per Player
  const baseEqualTime = Math.floor(totalOutfieldMinutesAvailable / numOutfieldPlayers);
  let remainderMinutes = totalOutfieldMinutesAvailable % numOutfieldPlayers;

  const updatedPlayers = players.map((player) => {
    if (player.role === 'GK') {
      return { ...player, minutes: isPermanentGK ? matchDuration : 0 };
    }

    // Handle outfield players
    let finalMinutes = baseEqualTime;
    // Distribute remainder minutes to the first N players
    if (remainderMinutes > 0) {
      finalMinutes += 1;
      remainderMinutes--;
    }

    // Apply manual override if set, otherwise use calculated minutes
    const effectiveMinutes = player.manualMinutes !== null ? player.manualMinutes : finalMinutes;

    return { ...player, minutes: effectiveMinutes };
  });

  return updatedPlayers;
};

/**
 * Generates a basic automatic substitution plan based on equal minutes,
 * ensuring minutes are balanced across the two halves.
 */
const generateAutomaticPlan = (settings, playersWithMinutes) => {
  const { gameFormat, matchDuration, selectedFormation, subInterval, firstSubTime, maxSubs, matchPeriods } = settings;
  const positions = FORMATIONS[gameFormat].formations[selectedFormation];
  const outfieldSpots = positions.length;

  const periods = gameFormat === '5v5' && matchPeriods === 'Quarters' ? 4 : 2;
  const halfDuration = matchDuration / 2;
  const periodDuration = matchDuration / periods;

  // Filter players who will participate in the outfield rotation and sort by minutes
  let outfieldPlayers = playersWithMinutes
    .filter(p => p.role !== 'GK' && p.minutes > 0)
    .sort((a, b) => a.minutes - b.minutes);

  if (outfieldPlayers.length <= outfieldSpots) {
    return `--- Match Info ---\nFormat: ${gameFormat} (${matchPeriods})\nDuration: ${matchDuration} min (${periods} x ${periodDuration} min periods)\n\nAll participating players can play the full match duration based on the squad size and game format. No substitutions required for minutes management.`;
  }

  const gkPlayer = playersWithMinutes.find(p => p.role === 'GK');

  let plan = `--- Match Info ---\nFormat: ${gameFormat} (${matchPeriods})\nDuration: ${matchDuration} min (Half: ${halfDuration} min)\n\n`;
  plan += `GK: ${gkPlayer ? gkPlayer.name : 'Unassigned GK'}\n`;
  plan += `Formation: ${selectedFormation} (${outfieldSpots} outfield spots)\n\n`;
  
  // Players currently on the field and those on the bench
  let playing = [];
  let bench = [];
  let rotationQueue = [...outfieldPlayers]; // Queue for managing initial rotation
  let subCount = 0;

  // 1. Assign starters and bench for the FIRST HALF
  // Players who play less overall are prioritized to start.
  for (let i = 0; i < outfieldSpots; i++) {
    playing.push(rotationQueue.shift()); 
  }
  bench = rotationQueue;
  
  // Track minutes played per player in the *current period* (Half or Quarter)
  let currentPeriodMinutes = new Map(outfieldPlayers.map(p => [p.id, 0]));

  // --- STARTING LINEUP ---
  plan += `--- STARTING LINEUP (0:00) ---\n`;
  playing.forEach((p, i) => {
    plan += `${positions[i]}: ${p.name} (Target Mins/Half: ${Math.ceil(p.minutes / periods * 2)})\n`;
  });
  plan += `\n`;

  // --- ROTATION SIMULATION ---
  for (let period = 1; period <= periods; period++) {
    const periodStart = (period - 1) * periodDuration;
    const periodEnd = period * periodDuration;
    let time = periodStart + firstSubTime;
    let lastSubTime = periodStart;
    
    // Period Header
    if (period > 1) {
        const periodName = periods === 4 ? `QUARTER ${period}` : `SECOND HALF`;
        plan += `\n*** ${periodName} START (${periodStart}:00) - ROTATION RESET FOR EVEN MINUTES ***\n\n`;

        // At the start of the second half (or quarter 3/4), swap the playing and bench queues
        // This ensures players who were benched for the first period start the next.
        const allPlayers = [...playing, ...bench];
        
        // New starters are the players who played the least in the entire first half/periods.
        // For simplicity: Players currently on the bench start the next half/period.
        let newPlaying = allPlayers.filter(p => bench.map(b => b.id).includes(p.id)).slice(0, outfieldSpots);
        let newBench = allPlayers.filter(p => !newPlaying.map(np => np.id).includes(p.id));

        // Re-align playing and bench queues
        playing = newPlaying;
        bench = newBench;
        
        // Reset period minutes tracking
        currentPeriodMinutes.forEach((v, k) => currentPeriodMinutes.set(k, 0));
        
        // Print new lineup
        plan += `--- STARTING LINEUP (${periodStart}:00) ---\n`;
        playing.forEach((p, i) => {
            plan += `${positions[i]}: ${p.name}\n`;
        });
        plan += `\n`;
        
        time = periodStart + firstSubTime;
        lastSubTime = periodStart;
    }


    // --- Run Substitutions within the Period ---
    while (time <= periodEnd) {
      if (bench.length === 0) break; // No one left to sub in

      const elapsed = time - lastSubTime;
      const outgoingCandidates = [];

      // 1. Identify OUTGOING players
      // Outgoing players are those on the field who have played the longest in this period.
      // And prioritize slots that allow a good position match from the bench.
      
      playing.forEach((player, index) => {
          // Increment period minutes for players currently playing
          currentPeriodMinutes.set(player.id, currentPeriodMinutes.get(player.id) + elapsed);
          outgoingCandidates.push({ 
              player, 
              position: positions[index], 
              index,
              periodTimePlayed: currentPeriodMinutes.get(player.id)
          });
      });
      
      // Sort to find players who have played the most in this period
      outgoingCandidates.sort((a, b) => b.periodTimePlayed - a.periodTimePlayed);
      
      const subsForThisWindow = Math.min(maxSubs, bench.length, outgoingCandidates.length);
      const subsBlock = [];
      const slotsToFill = [];
      
      // Select the N players playing the most time in this period to sub out
      const playersToSubOut = outgoingCandidates.slice(0, subsForThisWindow);

      // 2. Identify INCOMING players (bench players who have played the least overall)
      let incomingCandidates = [...bench].sort((a, b) => a.minutes - b.minutes);
      
      playersToSubOut.forEach((outgoing) => {
          // Find best incoming player based on preferred position match
          const position = outgoing.position;
          
          // Simple rotation: take the first player on the bench queue (who played least)
          const incoming = incomingCandidates.shift();
          if (!incoming) return;

          // Update the field lineup
          playing[outgoing.index] = incoming;
          
          // Record the substitution
          subsBlock.push({
              on: incoming,
              off: outgoing.player,
              position: position,
              index: outgoing.index
          });
          
          // Remove from bench queue
          bench = bench.filter(p => p.id !== incoming.id);
          // Add outgoing player to the end of the bench queue
          bench.push(outgoing.player);
      });

      // 3. Update Plan Text
      if (subsBlock.length > 0) {
          subCount += subsBlock.length;
          plan += `--- Substitution at ${String(time).padStart(2, '0')}:00 ---\n`;
          subsBlock.forEach(sub => {
              plan += `ON: ${sub.on.name} (${sub.position} slot) | OFF: ${sub.off.name}\n`;
          });
          plan += `\n`;
      }
      
      lastSubTime = time;
      time += subInterval;

      if (time > periodEnd) break;
    }
  }

  plan += `--- Match End (${matchDuration}:00) ---\n`;
  plan += `Total substitutions made: ${subCount}. \n\n`;
  plan += '***Note: This automatic plan ensures equal minutes across the two halves by resetting the playing/bench queues at halftime. The positions are fixed based on the starting formation.***';

  return plan;
};


// --- UI COMPONENTS ---

const PlayerInputRow = ({ player, index, settings, setPlayers, subscriptionTier, allPositions }) => {
  const isChampionship = subscriptionTier !== 'Basic';
  const isPremiership = subscriptionTier === 'Premiership';

  const handleChange = (field, value) => {
    setPlayers(prev => prev.map(p =>
      p.id === player.id ? { ...p, [field]: value } : p
    ));
  };

  return (
    <div className="flex items-center space-x-2 py-2 border-b border-gray-100">
      <span className="text-xs font-semibold w-6 text-center text-gray-500">{index + 1}</span>
      <input
        type="text"
        placeholder={`Player Name ${index + 1}`}
        value={player.name}
        onChange={(e) => handleChange('name', e.target.value)}
        className="flex-grow p-2 border rounded-lg focus:ring-sky-blue focus:border-sky-blue transition duration-150"
      />
      <select
        value={player.preferredPosition}
        onChange={(e) => handleChange('preferredPosition', e.target.value)}
        className="p-2 border rounded-lg w-28 text-sm bg-white"
      >
        <option value="">Pref. Pos.</option>
        {allPositions.map(pos => <option key={pos} value={pos}>{pos}</option>)}
      </select>

      {isChampionship && (
        <select
          value={player.secondaryPosition}
          onChange={(e) => handleChange('secondaryPosition', e.target.value)}
          className={`p-2 border rounded-lg w-28 text-sm bg-white ${isChampionship ? '' : 'bg-gray-100'}`}
          disabled={!isChampionship}
        >
          <option value="">Sec. Pos.</option>
          {allPositions.map(pos => <option key={pos} value={pos}>{pos}</option>)}
        </select>
      )}

      {isChampionship && (
        <input
          type="number"
          placeholder="Manual Mins"
          value={player.manualMinutes === null ? '' : player.manualMinutes}
          onChange={(e) => handleChange('manualMinutes', e.target.value === '' ? null : parseInt(e.target.value, 10))}
          className={`p-2 border rounded-lg w-24 text-sm text-center ${isPremiership ? '' : 'opacity-50'}`}
          disabled={!isChampionship}
        />
      )}
    </div>
  );
};

const PlayerCircle = ({ name, position, isGK, color = COLORS.SKY_BLUE, yPos, xPos }) => (
  <div
    className="absolute flex flex-col items-center justify-center transition-all duration-500 ease-in-out"
    style={{ top: `${yPos}%`, left: `${xPos}%`, transform: 'translate(-50%, -50%)', zIndex: Math.round(yPos) }}
    title={`${name} (${position})`}
  >
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg border-2"
      style={{
        backgroundColor: color,
        borderColor: isGK ? COLORS.ORANGE : color,
      }}
    >
      {/* Display initials */}
      {name.split(' ').map(n => n[0]).join('')}
    </div>
    <span className={`text-xs mt-1 font-medium text-center`} style={{ color: COLORS.NAVY_BLUE }}>{position}</span>
  </div>
);


const PositionVisualizer = ({ settings, players }) => {
  const { gameFormat, selectedFormation } = settings;
  const positions = useMemo(() => FORMATIONS[gameFormat]?.formations[selectedFormation] || [], [gameFormat, selectedFormation]);
  const outfieldSpots = positions.length;

  // Coordinate mapping for a simple 2D pitch visual (responsive)
  const getPositionCoordinates = (position) => {
    // Top-to-Bottom (Defense to Attack)
    const map = {
        // Defense
        GK: { y: 95, x: 50 },
        RB: { y: 80, x: 20 }, LB: { y: 80, x: 80 },
        CD: { y: 85, x: 50 }, 'CD-R': { y: 85, x: 35 }, 'CD-L': { y: 85, x: 65 },

        // Midfield
        CDM: { y: 70, x: 50 }, 'CDM-R': { y: 70, x: 30 }, 'CDM-L': { y: 70, x: 70 },
        CM: { y: 50, x: 50 }, 'CM-R': { y: 50, x: 30 }, 'CM-L': { y: 50, x: 70 },
        CAM: { y: 35, x: 50 },

        // Attack
        RW: { y: 25, x: 15 }, LW: { y: 25, x: 85 },
        ST: { y: 15, x: 50 }, 'ST-R': { y: 20, x: 35 }, 'ST-L': { y: 20, x: 65 },
    };
    return map[position] || { y: Math.random() * 80 + 10, x: Math.random() * 80 + 10 };
  };

  // Get the players who are starting (first N outfield players + GK)
  const startingPlayers = players.filter(p => p.name.trim() !== '');
  const gkPlayer = startingPlayers.find(p => p.role === 'GK') || startingPlayers[0]; // Player 1 is default GK
  const startingOutfieldPlayers = startingPlayers.filter(p => p.role !== 'GK').slice(0, outfieldSpots);

  const visualPlayers = startingOutfieldPlayers.map((player, index) => {
    const position = positions[index] || 'SUB';
    const { y, x } = getPositionCoordinates(position);
    const color = index === 0 ? COLORS.ORANGE : COLORS.SKY_BLUE;
    return <PlayerCircle key={player.id} name={player.name} position={position} isGK={false} color={color} yPos={y} xPos={x} />;
  });

  // Add the GK
  if (gkPlayer) {
    const { y, x } = getPositionCoordinates('GK');
    visualPlayers.push(<PlayerCircle key={gkPlayer.id} name={gkPlayer.name} position="GK" isGK={true} color={COLORS.NAVY_BLUE} yPos={y} xPos={x} />);
  }

  return (
    <div className="relative w-full h-96 border-4 border-green-800 bg-green-700/80 rounded-xl overflow-hidden shadow-inner">
      {/* Pitch markings */}
      <div className="absolute inset-0 border-white border-2 m-4 rounded-lg opacity-80">
        <div className="absolute top-1/2 left-1/2 w-20 h-20 border-white border-2 rounded-full transform -translate-x-1/2 -translate-y-1/2 opacity-80"></div>
        <div className="absolute top-0 left-1/2 w-40 h-10 border-white border-2 transform -translate-x-1/2"></div>
        <div className="absolute bottom-0 left-1/2 w-40 h-10 border-white border-2 transform -translate-x-1/2 -scale-y-100"></div>
      </div>

      {visualPlayers}

      <div className="absolute bottom-2 right-2 text-xs font-semibold text-white bg-black/50 p-1 rounded">
        {settings.gameFormat} - {selectedFormation}
      </div>
    </div>
  );
};


const SubscriptionBadge = ({ tier }) => {
  let color, icon, text;

  if (tier === 'Premiership') {
    color = COLORS.GOLD;
    icon = <Star className="w-4 h-4 text-white fill-current mr-1" />;
    text = 'Premiership';
  } else if (tier === 'Championship') {
    color = COLORS.SKY_BLUE;
    icon = <Unlock className="w-4 h-4 text-white mr-1" />;
    text = 'Championship';
  } else {
    color = COLORS.NAVY_BLUE;
    icon = null;
    text = 'Basic (FREE)';
  }

  return (
    <div
      className="px-3 py-1 rounded-full text-xs font-bold flex items-center shadow-md"
      style={{ backgroundColor: color, color: COLORS.WHITE }}
    >
      {icon}
      {text}
    </div>
  );
};

const Button = ({ children, color = COLORS.ORANGE, disabled, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center justify-center px-6 py-3 rounded-xl font-bold text-white shadow-lg transition duration-200 ${
      disabled
        ? 'opacity-50 cursor-not-allowed bg-gray-400'
        : 'hover:opacity-90 active:scale-[0.98]'
    }`}
    style={{ backgroundColor: color }}
  >
    {children}
  </button>
);

// --- MAIN APPLICATION COMPONENT ---

const App = () => {
  const { db, userId, isAuthReady, firestorePath, error } = useFirebase();

  // Mocked Subscription Tier (for demonstration)
  // Options: 'Basic', 'Championship', 'Premiership'
  const [subscriptionTier, setSubscriptionTier] = useState('Premiership');

  // --- State for Settings and Players ---
  const [settings, setSettings] = useState(() => {
    const defaultFormat = '9v9';
    return {
      gameFormat: defaultFormat,
      matchDuration: MATCH_DURATIONS[defaultFormat],
      squadSize: 11,
      isPermanentGK: true,
      selectedFormation: '3-3-2',
      planType: 'Automatic', 
      subInterval: 10,
      firstSubTime: 10,
      maxSubs: 2,
      matchPeriods: 'Halves', 
    };
  });
  
  // Players state setup with initial mock data
  const [players, setPlayers] = useState(
    Array.from({ length: 20 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: i === 0 ? 'Ella (GK)' : i === 1 ? 'Mia' : i < 11 ? `Player ${i + 1}` : '',
      role: i === 0 ? 'GK' : 'Outfield',
      preferredPosition: i === 0 ? 'GK' : '',
      secondaryPosition: '',
      manualMinutes: null,
    }))
  );

  const [matchPlan, setMatchPlan] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [savedSquads, setSavedSquads] = useState([]);
  const [isSavingLoading, setIsSavingLoading] = useState(false);


  // --- Derived State and Constraints ---

  const maxSquads = subscriptionTier === 'Championship' ? 2 : Infinity;
  const isChampionship = subscriptionTier !== 'Basic';
  const isPremiership = subscriptionTier === 'Premiership';
  const outfieldSpots = FORMATIONS[settings.gameFormat]?.maxPlayers || 0;
  const formationsAvailable = FORMATIONS[settings.gameFormat]?.formations || {};

  const activePlayers = useMemo(() => players.filter(p => p.name.trim() !== ''), [players]);

  // Player list displayed/used based on squad size input
  const displayedPlayers = useMemo(() => players.slice(0, settings.squadSize), [players, settings.squadSize]);

  // Update Formation and Duration when format changes
  useEffect(() => {
    const duration = MATCH_DURATIONS[settings.gameFormat];
    const defaultFormation = Object.keys(formationsAvailable)[0];
    
    setSettings(prev => ({ 
      ...prev, 
      matchDuration: duration,
      selectedFormation: defaultFormation,
      matchPeriods: settings.gameFormat === '5v5' ? prev.matchPeriods : 'Halves', 
    }));
  }, [settings.gameFormat]);

  // --- FIREBASE: SQUAD PERSISTENCE LOGIC ---

  const fetchSquads = useCallback(async () => {
    if (!isAuthReady || !db || !firestorePath) return;

    setIsSavingLoading(true);
    try {
      const collectionRef = collection(db, firestorePath);
      const q = query(collectionRef);
      
      const docs = await retryFetch(() => getDocs(q));

      const squads = docs.docs.map(d => ({
        id: d.id,
        name: d.data().name,
        data: d.data().players,
      }));
      setSavedSquads(squads);

    } catch (e) {
      console.error('Error fetching squads:', e);
    } finally {
      setIsSavingLoading(false);
    }
  }, [db, firestorePath, isAuthReady]);

  useEffect(() => {
    if (isChampionship) {
      fetchSquads();
    }
  }, [isChampionship, fetchSquads]);


  const handleSaveSquad = async () => {
    if (!isChampionship || (!isPremiership && savedSquads.length >= maxSquads)) {
      console.error('Cannot save: Subscription limits reached.');
      return;
    }

    // Since window.prompt is unavailable, use a simple timestamp name
    const squadName = `Squad ${new Date().toLocaleTimeString()} (${settings.gameFormat})`;

    if (!squadName) return;

    setIsSavingLoading(true);
    try {
      const squadData = {
        name: squadName,
        players: displayedPlayers.filter(p => p.name.trim() !== ''), // Only save active players
        createdAt: new Date().toISOString(),
      };
      
      const newDocRef = doc(collection(db, firestorePath));
      await retryFetch(() => setDoc(newDocRef, squadData));
      
      console.log('Squad saved successfully.');
      fetchSquads(); // Refresh the list
    } catch (e) {
      console.error('Error saving squad:', e);
    } finally {
      setIsSavingLoading(false);
    }
  };

  const handleLoadSquad = (squadData) => {
    const loadedPlayers = squadData.map((p, i) => ({ ...p, id: p.id || crypto.randomUUID() }));
    setSettings(prev => ({ ...prev, squadSize: loadedPlayers.length }));

    // Reset player array and insert loaded players
    const newPlayers = Array.from({ length: 20 }, (_, i) => {
      if (i < loadedPlayers.length) {
        return loadedPlayers[i];
      }
      return { id: crypto.randomUUID(), name: '', role: 'Outfield', preferredPosition: '', secondaryPosition: '', manualMinutes: null };
    });
    setPlayers(newPlayers);
    setMatchPlan('');
    console.log('Squad loaded.');
  };

  const handleDeleteSquad = async (id) => {
    
    // Using console log for confirmation in non-interactive environment
    console.log(`Squad deletion requested for ID: ${id}`);
    
    setIsSavingLoading(true);
    try {
      const docRef = doc(db, firestorePath, id);
      await retryFetch(() => deleteDoc(docRef));
      console.log('Squad deleted successfully.');
      fetchSquads();
    } catch (e) {
      console.error('Error deleting squad:', e);
    } finally {
      setIsSavingLoading(false);
    }
  };


  // --- PLAN GENERATION HANDLER ---

  const handleGeneratePlan = () => {
    if (activePlayers.length < outfieldSpots + 1) { // Need at least GK + outfield spots
      setMatchPlan('Error: Not enough players to fill the formation spots.');
      return;
    }
    if (!settings.matchDuration || settings.matchDuration <= 0) {
      setMatchPlan('Error: Match duration must be greater than zero.');
      return;
    }

    setIsGenerating(true);
    setMatchPlan(''); // Clear previous plan

    // Simulate API delay for planning
    setTimeout(() => {
      try {
        const playersWithCalculatedMinutes = calculateEqualMinutes(settings, displayedPlayers);

        let planText;
        if (settings.planType === 'Automatic') {
          planText = generateAutomaticPlan(settings, playersWithCalculatedMinutes);
        } else {
          // Placeholder for Manual Plan (Premiership feature)
          planText = `--- Manual Plan Creation (Premiership Only) ---\n\n`;
          planText += `To create a manual plan, you would use interactive controls here to define which player subs on and off at which minute. The plan below shows the starters.\n\n`;
          
          const gkPlayer = playersWithCalculatedMinutes.find(p => p.role === 'GK');
          planText += `GK: ${gkPlayer ? gkPlayer.name : 'Unassigned GK'}\n`;
          FORMATIONS[settings.gameFormat].formations[settings.selectedFormation].forEach((pos, i) => {
            planText += `${pos}: ${playersWithCalculatedMinutes.filter(p => p.role !== 'GK')[i]?.name || 'N/A'}\n`;
          });
        }

        setMatchPlan(planText);
      } catch (e) {
        setMatchPlan(`An error occurred during plan generation: ${e.message}`);
        console.error('Generation Error:', e);
      } finally {
        setIsGenerating(false);
      }
    }, 500);
  };

  // --- Render ---

  if (error) {
    return <div className="text-red-600 p-4 bg-red-100 rounded-lg m-4">Initialization Error: {error}</div>;
  }
  
  if (!isAuthReady) {
    return (
      <div className="flex justify-center items-center h-screen" style={{ backgroundColor: '#F0F4F8' }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: COLORS.NAVY_BLUE }} />
        <span className="ml-2 font-semibold" style={{ color: COLORS.NAVY_BLUE }}>Authenticating and Initializing...</span>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 min-h-screen" style={{ backgroundColor: COLORS.WHITE, fontFamily: 'Inter, sans-serif' }}>
      <header className="flex flex-col md:flex-row justify-between items-center pb-6 border-b-4 mb-6" style={{ borderColor: COLORS.NAVY_BLUE }}>
        <div className="flex items-center space-x-4">
          {/* Using a placeholder for the uploaded logo image */}
          <img
            src="https://placehold.co/100x100/193755/FFFFFF?text=Logo"
            alt="The Girls' Game Plan Logo"
            className="w-16 h-16 rounded-full"
          />
          <h1 className="text-4xl font-extrabold" style={{ color: COLORS.NAVY_BLUE }}>
            The Girls' Game Planner
          </h1>
        </div>
        <SubscriptionBadge tier={subscriptionTier} />
      </header>

      <p className="text-sm font-medium mb-6 p-3 rounded-lg" style={{ backgroundColor: COLORS.SKY_BLUE, color: COLORS.NAVY_BLUE }}>
        <User className="inline w-4 h-4 mr-1 align-sub" /> User ID: <span className="font-mono text-xs">{userId}</span>
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* --- LEFT COLUMN: SETTINGS & INPUT --- */}
        <div className="lg:col-span-1 space-y-6">
          <div className="p-6 rounded-xl shadow-2xl" style={{ backgroundColor: COLORS.NAVY_BLUE, color: COLORS.WHITE }}>
            <h2 className="text-2xl font-bold mb-4 flex items-center"><Settings className="w-6 h-6 mr-2" /> Match Setup</h2>

            <div className="space-y-4">
              {/* Game Format */}
              <label className="block">Game Format (XvX)</label>
              <select
                value={settings.gameFormat}
                onChange={(e) => setSettings(p => ({ ...p, gameFormat: e.target.value }))}
                className="w-full p-2 rounded-lg text-lg font-semibold" style={{ backgroundColor: COLORS.WHITE, color: COLORS.NAVY_BLUE }}
              >
                {Object.keys(FORMATIONS).map(f => <option key={f} value={f}>{f}</option>)}
              </select>

              {/* Match Duration (Fixed by Format) */}
              <label className="block pt-2">Match Duration (min)</label>
              <input
                type="number"
                value={settings.matchDuration}
                readOnly
                disabled
                className="w-full p-2 rounded-lg text-lg font-semibold bg-gray-200 cursor-not-allowed" style={{ color: COLORS.NAVY_BLUE }}
              />
              <p className="text-xs text-white/70 mt-1">Duration is set automatically based on FA guidelines for {settings.gameFormat}.</p>

              {/* 5v5 Period Selector */}
              {settings.gameFormat === '5v5' && (
                <div className="pt-2">
                  <label className="block">5v5 Match Periods</label>
                  <div className="flex space-x-4">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        checked={settings.matchPeriods === 'Halves'}
                        onChange={() => setSettings(p => ({ ...p, matchPeriods: 'Halves' }))}
                        className="mr-2"
                      /> Halves (2 x 20 min)
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        checked={settings.matchPeriods === 'Quarters'}
                        onChange={() => setSettings(p => ({ ...p, matchPeriods: 'Quarters' }))}
                        className="mr-2"
                      /> Quarters (4 x 10 min)
                    </label>
                  </div>
                </div>
              )}


              {/* Squad Size */}
              <label className="block pt-2">Squad Size</label>
              <input
                type="number"
                min={outfieldSpots + (settings.isPermanentGK ? 1 : 0)}
                value={settings.squadSize}
                onChange={(e) => {
                  const val = e.target.value;
                  const parsedVal = val === '' ? 0 : parseInt(val, 10);
                  setSettings(p => ({ ...p, squadSize: parsedVal }));
                }}
                className="w-full p-2 rounded-lg text-lg font-semibold" style={{ backgroundColor: COLORS.WHITE, color: COLORS.NAVY_BLUE }}
              />

              {/* GK Type */}
              <label className="block pt-2">Goalkeeper Rotation</label>
              <div className="flex space-x-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={settings.isPermanentGK}
                    onChange={() => setSettings(p => ({ ...p, isPermanentGK: true, gkRotation: false }))}
                    className="mr-2"
                  /> Permanent GK
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={!settings.isPermanentGK}
                    onChange={() => setSettings(p => ({ ...p, isPermanentGK: false, gkRotation: true }))}
                    className="mr-2"
                  /> Rotating GK
                </label>
              </div>

              {/* Formation */}
              <label className="block pt-2">Formation (Outfield Players)</label>
              <select
                value={settings.selectedFormation}
                onChange={(e) => setSettings(p => ({ ...p, selectedFormation: e.target.value }))}
                className="w-full p-2 rounded-lg text-lg font-semibold" style={{ backgroundColor: COLORS.WHITE, color: COLORS.NAVY_BLUE }}
              >
                {Object.keys(formationsAvailable).map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          {/* SQUAD SAVING SECTION (Championship+) */}
          {isChampionship && (
            <div className="p-6 rounded-xl shadow-lg border" style={{ borderColor: COLORS.NAVY_BLUE }}>
              <h3 className="text-xl font-bold mb-4 flex items-center" style={{ color: COLORS.NAVY_BLUE }}>
                <Save className="w-5 h-5 mr-2" style={{ color: COLORS.NAVY_BLUE }} /> Squad Management
              </h3>
              <p className="text-sm mb-4" style={{ color: COLORS.NAVY_BLUE }}>
                {isPremiership ? 'Unlimited Squad Saves' : `Save up to ${maxSquads} Squads`} (Current: {savedSquads.length})
              </p>

              <Button onClick={handleSaveSquad} disabled={isSavingLoading || (!isPremiership && savedSquads.length >= maxSquads)} color={COLORS.SKY_BLUE}>
                {isSavingLoading ? 'Saving...' : 'Save Current Squad'}
              </Button>

              <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                {savedSquads.map(squad => (
                  <div key={squad.id} className="flex justify-between items-center p-2 rounded-lg border" style={{ borderColor: COLORS.SKY_BLUE }}>
                    <span className="text-sm font-medium" style={{ color: COLORS.NAVY_BLUE }}>{squad.name} ({squad.data.length} players)</span>
                    <div className="flex space-x-1">
                      <button onClick={() => handleLoadSquad(squad.data)} className="text-xs px-2 py-1 rounded-full text-white" style={{ backgroundColor: COLORS.ORANGE }}>Load</button>
                      <button onClick={() => handleDeleteSquad(squad.id)} className="text-xs px-2 py-1 rounded-full text-white bg-red-500">Del</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* --- RIGHT COLUMN: PLAYERS & PLAN --- */}
        <div className="lg:col-span-2 space-y-6">
          {/* Player Input Section */}
          <div className="p-6 rounded-xl shadow-2xl bg-white">
            <h2 className="text-2xl font-bold mb-4 flex items-center" style={{ color: COLORS.NAVY_BLUE }}><User className="w-6 h-6 mr-2" /> Player Roster</h2>
            <div className="max-h-96 overflow-y-auto">
              {displayedPlayers.map((player, index) => (
                <PlayerInputRow
                  key={player.id}
                  player={player}
                  index={index}
                  settings={settings}
                  setPlayers={setPlayers}
                  subscriptionTier={subscriptionTier}
                  allPositions={ALL_POSITIONS}
                />
              ))}
            </div>
          </div>

          {/* Plan Type and Sub Settings */}
          <div className="p-6 rounded-xl shadow-lg bg-white border" style={{ borderColor: COLORS.SKY_BLUE }}>
            <h3 className="text-xl font-bold mb-4" style={{ color: COLORS.NAVY_BLUE }}>Plan Options</h3>
            
            <div className="flex space-x-4 mb-4">
              <label className="flex items-center font-medium" style={{ color: COLORS.NAVY_BLUE }}>
                <input
                  type="radio"
                  checked={settings.planType === 'Automatic'}
                  onChange={() => setSettings(p => ({ ...p, planType: 'Automatic' }))}
                  className="mr-2"
                /> Automatic (Equal Minutes)
              </label>
              <label className={`flex items-center font-medium ${isPremiership ? '' : 'opacity-50 cursor-not-allowed'}`} style={{ color: COLORS.NAVY_BLUE }}>
                <input
                  type="radio"
                  checked={settings.planType === 'Manual'}
                  onChange={() => isPremiership && setSettings(p => ({ ...p, planType: 'Manual' }))}
                  className="mr-2"
                  disabled={!isPremiership}
                /> Manual Plan {isPremiership ? '' : '(Premiership Only)'}
              </label>
            </div>

            {settings.planType === 'Automatic' && (
              <div className={`grid grid-cols-3 gap-4 p-4 rounded-lg border-dashed border ${isPremiership ? '' : 'opacity-50 pointer-events-none bg-gray-50'}`} style={{ borderColor: COLORS.NAVY_BLUE }}>
                <p className={`col-span-3 text-sm font-semibold mb-2 ${isPremiership ? 'text-gray-700' : 'text-orange-500'}`}>
                  {isPremiership ? 'Substitution Frequency (Premiership)' : 'Upgrade to Premiership for Sub Control'}
                </p>
                <div>
                  <label className="block text-sm font-medium" style={{ color: COLORS.NAVY_BLUE }}>Interval (min)</label>
                  <select
                    value={settings.subInterval}
                    onChange={(e) => setSettings(p => ({ ...p, subInterval: parseInt(e.target.value, 10) }))}
                    className="w-full p-2 rounded-lg text-sm" style={{ backgroundColor: COLORS.WHITE, color: COLORS.NAVY_BLUE }}
                    disabled={!isPremiership}
                  >
                    {[5, 8, 10, 15].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium" style={{ color: COLORS.NAVY_BLUE }}>First Sub (min)</label>
                  <select
                    value={settings.firstSubTime}
                    onChange={(e) => setSettings(p => ({ ...p, firstSubTime: parseInt(e.target.value, 10) }))}
                    className="w-full p-2 rounded-lg text-sm" style={{ backgroundColor: COLORS.WHITE, color: COLORS.NAVY_BLUE }}
                    disabled={!isPremiership}
                  >
                    {[5, 8, 10, 15].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium" style={{ color: COLORS.NAVY_BLUE }}>Max Subs (#)</label>
                  <select
                    value={settings.maxSubs}
                    onChange={(e) => setSettings(p => ({ ...p, maxSubs: parseInt(e.target.value, 10) }))}
                    className="w-full p-2 rounded-lg text-sm" style={{ backgroundColor: COLORS.WHITE, color: COLORS.NAVY_BLUE }}
                    disabled={!isPremiership}
                  >
                    {[1, 2, 3, 4].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
            )}
            
            <Button onClick={handleGeneratePlan} disabled={isGenerating} color={COLORS.ORANGE} className="mt-6 w-full">
              {isGenerating ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Play className="w-5 h-5 mr-2" />}
              {isGenerating ? 'Generating...' : 'Generate Match Plan'}
            </Button>
          </div>
        </div>
      </div>

      {/* --- BOTTOM SECTION: OUTPUT --- */}
      <div className="mt-8">
        <h2 className="text-3xl font-bold mb-4" style={{ color: COLORS.NAVY_BLUE }}>Match Plan Output</h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Text Plan (All Tiers) */}
          <div className="p-6 rounded-xl shadow-xl bg-gray-50">
            <h3 className="text-xl font-bold mb-4 border-b pb-2" style={{ color: COLORS.NAVY_BLUE, borderColor: COLORS.SKY_BLUE }}>Substitution Schedule</h3>
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed" style={{ color: COLORS.NAVY_BLUE }}>
              {matchPlan || 'Press "Generate Match Plan" to see the schedule here. Match info will display the selected periods for 5v5.'}
            </pre>
          </div>

          {/* Formation Visual (Basic: Starting Lineup. Championship+: Live Updates) */}
          <div className="p-6 rounded-xl shadow-xl bg-white">
            <h3 className="text-xl font-bold mb-4 border-b pb-2" style={{ color: COLORS.NAVY_BLUE, borderColor: COLORS.SKY_BLUE }}>
              Starting Formation Visual
            </h3>
            {settings.selectedFormation && (
              <PositionVisualizer settings={settings} players={displayedPlayers} />
            )}
          </div>
        </div>
      </div>

    </div>
  );
};

export default App;
