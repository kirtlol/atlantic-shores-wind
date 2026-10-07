// Night-sky products for the atmosphere (owner: atmosphere): the bright-star catalogue and the
// Milky Way panorama.
//
// Stars: the naked-eye bright stars of every constellation visible from 39.3 N down to V ~ 3.9
// (plus a few fainter ones that complete familiar figures: the Pleiades, Lyra's parallelogram,
// Corona Borealis, Delphinus, Sagitta, the Little Dipper): J2000 positions to ~1 arcmin with V and
// B-V as listed in the Yale Bright Star Catalogue (5th ed.), transcribed by hand (the published
// page cannot fetch data: its CSP blocks it), precessed to the scene's epoch at load. A reviewer
// should spot-check any star against the BSC; the rendered sky has been checked against computed
// positions of Antares, Vega, Altair, Deneb, Arcturus and Polaris (p1fix atmosphere report). They are baked into a cell grid on the same equi-angular cube of the
// celestial sphere the procedural faint-star field uses, so the dome finds a star with one texel
// fetch; the procedural field only supplies stars fainter than the catalogue's limit.
//
// Milky Way: a galactic-coordinate panorama (l, b) baked once on the GPU: an exponential disk whose
// scale height grows from the centre to the anticentre, the bulge, the Sagittarius, Scutum and
// Cygnus star clouds, ridged-noise mottling, and dust (the branched Great Rift from Cygnus to
// Sagittarius, the Ophiuchus dark clouds and a mottled mid-plane lane). Relative units: 1 = the
// band's mean surface brightness at mid longitudes; the atmosphere scales it.
import * as THREE from 'three';
import { HASH_GLSL } from './clouds.js';

// The catalogue, as transcribed (the source of STAR_DATA below; any edit here must be re-packed):
// [RA hh.mm (minutes), Dec dd.mm (arcminutes, signed), V, B-V]
// RA written as hours + minutes/100, Dec as degrees + arcminutes/100 (sign applies to both).
// Ursa Major
//   [11.037, 61.45, 1.79, 1.07], [11.018, 56.23, 2.37, -0.02], [11.538, 53.42, 2.44, 0.04], [12.154, 57.02, 3.31, 0.08],
//   [12.540, 55.58, 1.77, -0.02], [13.239, 54.56, 2.27, 0.02], [13.475, 49.19, 1.86, -0.19], [11.097, 44.30, 3.01, 1.14],
//   [10.223, 41.30, 3.05, 1.59], [11.185, 33.06, 3.48, 1.40], [8.592, 48.02, 3.14, 0.19], [9.329, 51.41, 3.17, 0.46],
//   [10.171, 42.55, 3.45, 0.03], [8.303, 60.43, 3.36, 0.85], [9.036, 47.09, 3.60, 0.00], [11.461, 47.47, 3.71, 1.18],
// Ursa Minor
//   [2.318, 89.16, 1.98, 0.60], [14.507, 74.09, 2.08, 1.47], [15.207, 71.50, 3.00, 0.05], [17.322, 86.35, 4.36, 0.02],
//   [16.460, 82.02, 4.21, 0.89], [15.441, 77.48, 4.29, 0.04], [16.175, 75.45, 4.95, 0.37],
// Cassiopeia
//   [0.405, 56.32, 2.24, 1.17], [0.092, 59.09, 2.28, 0.34], [0.567, 60.43, 2.47, -0.15], [1.258, 60.14, 2.68, 0.13], [1.544, 63.40, 3.37, -0.15],
// Cepheus
//   [21.186, 62.35, 2.45, 0.22], [21.287, 70.34, 3.23, -0.22], [23.393, 77.38, 3.21, 1.03], [22.109, 58.12, 3.35, 1.57],
//   [22.497, 66.12, 3.52, 1.05], [20.453, 61.50, 3.43, 0.92], [22.292, 58.25, 4.07, 0.60],
// Draco
//   [17.566, 51.29, 2.23, 1.52], [17.304, 52.18, 2.79, 0.98], [19.126, 67.40, 3.07, 1.00], [17.088, 65.43, 3.17, -0.12],
//   [16.240, 61.31, 2.73, 0.91], [15.249, 58.58, 3.29, 1.16], [14.044, 64.22, 3.65, -0.05], [17.535, 56.52, 3.75, 1.18],
//   [18.210, 72.44, 3.57, 0.49], [19.482, 70.16, 3.83, 0.89], [11.314, 69.20, 3.84, 1.62], [12.335, 69.47, 3.87, -0.13],
// Lyra
//   [18.369, 38.47, 0.03, 0.00], [18.501, 33.22, 3.52, 0.00], [18.589, 32.41, 3.24, -0.05], [18.448, 37.36, 4.36, 0.19],
//   [18.545, 36.54, 4.30, 1.68], [18.443, 39.40, 4.67, 0.18],
// Cygnus
//   [20.414, 45.17, 1.25, 0.09], [20.222, 40.15, 2.23, 0.67], [20.462, 33.58, 2.48, 1.03], [19.450, 45.08, 2.87, -0.03],
//   [19.307, 27.58, 3.08, 1.13], [21.129, 30.14, 3.20, 0.99], [21.049, 43.56, 3.72, 1.65], [21.148, 38.03, 3.72, 0.39],
//   [19.297, 51.44, 3.79, 0.14], [19.171, 53.22, 3.80, 0.96], [19.563, 35.05, 3.89, 1.02], [20.572, 41.10, 3.94, 0.02],
// Aquila
//   [19.508, 8.52, 0.77, 0.22], [19.463, 10.37, 2.72, 1.52], [19.553, 6.24, 3.71, 0.86], [19.054, 13.52, 2.99, 0.01],
//   [19.255, 3.07, 3.36, 0.32], [19.062, -4.53, 3.44, -0.09], [20.113, -0.49, 3.23, -0.07], [19.525, 1.00, 3.87, 0.89],
//   [18.596, 15.04, 4.02, 1.08],
// Sagitta, Delphinus, Vulpecula, Equuleus
//   [19.588, 19.29, 3.47, 1.57], [19.474, 18.32, 3.82, 1.41], [19.401, 18.01, 4.37, 0.78], [19.410, 17.29, 4.37, 1.05],
//   [20.376, 14.36, 3.63, 0.44], [20.396, 15.55, 3.77, -0.06], [20.467, 16.07, 4.27, 1.04], [20.435, 15.04, 4.43, 0.32],
//   [20.332, 11.18, 4.03, -0.13], [19.287, 24.40, 4.44, 1.50], [21.158, 5.15, 3.92, 0.53],
// Hercules
//   [16.302, 21.29, 2.77, 0.94], [16.413, 31.36, 2.81, 0.65], [17.150, 36.49, 3.16, 1.44], [16.429, 38.55, 3.48, 0.92],
//   [17.003, 30.56, 3.92, -0.01], [17.146, 14.23, 3.35, 1.44], [17.150, 24.50, 3.14, 0.08], [17.465, 27.43, 3.42, 0.75],
//   [17.578, 29.15, 3.70, 0.94], [18.075, 28.46, 3.83, -0.03], [17.563, 37.15, 3.86, 1.35], [17.395, 46.00, 3.80, -0.18],
//   [16.219, 19.09, 3.75, 0.27], [16.197, 46.19, 3.89, -0.15], [18.237, 21.46, 3.84, 1.18],
// Corona Borealis
//   [15.347, 26.43, 2.23, -0.02], [15.278, 29.06, 3.66, 0.28], [15.427, 26.18, 3.84, -0.03], [15.329, 31.22, 4.14, -0.13],
//   [15.496, 26.04, 4.63, 0.80], [15.576, 26.53, 4.15, 1.23],
// Bootes
//   [14.157, 19.11, -0.05, 1.23], [14.450, 27.04, 2.37, 0.97], [13.547, 18.24, 2.68, 0.58], [14.321, 38.18, 3.03, 0.19],
//   [15.019, 40.23, 3.50, 0.97], [15.155, 33.19, 3.47, 0.95], [14.318, 30.22, 3.58, 1.30], [14.411, 13.44, 3.78, 0.05],
//   [15.245, 37.23, 4.31, 0.58],
// Serpens
//   [15.443, 6.26, 2.63, 1.17], [15.496, -3.26, 3.54, -0.04], [15.508, 4.29, 3.71, 0.15], [15.462, 15.25, 3.67, 0.06],
//   [15.348, 10.32, 3.80, 0.26], [15.565, 15.40, 3.85, 0.48], [15.487, 18.08, 4.09, 1.62], [18.213, -2.54, 3.23, 0.94],
//   [17.376, -15.24, 3.54, 0.26], [18.562, 4.12, 4.10, 0.17], [17.208, -12.51, 4.33, 0.04],
// Ophiuchus
//   [17.349, 12.34, 2.07, 0.15], [17.104, -15.43, 2.43, 0.06], [16.372, -10.34, 2.54, 0.02], [16.143, -3.42, 2.73, 1.58],
//   [17.435, 4.34, 2.77, 1.16], [16.577, 9.23, 3.19, 1.15], [16.183, -4.42, 3.23, 0.97], [17.220, -25.00, 3.26, -0.19],
//   [17.590, -9.46, 3.34, 0.99], [18.073, 9.34, 3.71, 0.12], [17.479, 2.42, 3.75, 0.04], [16.309, 1.59, 3.82, 0.01],
// Scorpius
//   [16.294, -26.26, 1.06, 1.83], [17.336, -37.06, 1.62, -0.22], [17.373, -43.00, 1.86, 0.40], [16.003, -22.37, 2.29, -0.12],
//   [16.502, -34.18, 2.29, 1.15], [17.425, -39.02, 2.39, -0.22], [16.054, -19.48, 2.62, -0.07], [17.308, -37.18, 2.70, -0.22],
//   [16.359, -28.13, 2.82, -0.25], [15.589, -26.07, 2.89, -0.19], [16.212, -25.36, 2.89, 0.13], [17.476, -40.08, 3.03, 0.51],
//   [16.519, -38.03, 3.00, -0.20], [17.499, -37.03, 3.19, 1.17], [17.122, -43.14, 3.33, 0.41], [16.546, -42.22, 3.62, 1.37],
//   [15.569, -29.13, 3.87, -0.20],
// Sagittarius
//   [18.242, -34.23, 1.85, -0.03], [18.553, -26.18, 2.05, -0.13], [19.026, -29.53, 2.60, 0.08], [18.210, -29.50, 2.70, 1.38],
//   [18.280, -25.25, 2.81, 1.04], [18.058, -30.25, 2.99, 1.00], [19.098, -21.01, 2.89, 0.35], [18.457, -26.59, 3.17, -0.11],
//   [19.069, -27.40, 3.32, 1.19], [18.577, -21.06, 3.51, 1.18], [18.138, -21.03, 3.86, 0.23], [18.176, -36.46, 3.11, 1.56],
//   [19.047, -21.44, 3.76, 1.01], [19.217, -17.51, 3.93, 0.22], [19.553, -41.52, 4.13, 1.08], [19.240, -40.37, 3.97, -0.10],
//   [19.226, -44.28, 4.01, -0.10],
// Scutum
//   [18.352, -8.15, 3.85, 1.33], [18.472, -4.45, 4.22, 1.10],
// Capricornus
//   [21.470, -16.08, 2.87, 0.29], [20.210, -14.47, 3.08, 0.79], [20.181, -12.33, 3.57, 0.94], [21.401, -16.40, 3.67, 0.32],
//   [21.267, -22.25, 3.74, 1.00], [21.059, -17.14, 4.07, -0.01], [20.518, -26.55, 4.12, 1.64], [20.461, -25.16, 4.14, 0.43],
// Aquarius
//   [21.316, -5.34, 2.90, 0.83], [22.058, -0.19, 2.95, 0.98], [22.547, -15.49, 3.27, 0.05], [22.288, -0.01, 3.65, 0.38],
//   [22.526, -7.35, 3.74, 1.64], [20.477, -9.30, 3.78, 0.00], [22.217, -1.23, 3.84, -0.05], [22.354, -0.07, 4.02, -0.09],
//   [22.168, -7.47, 4.16, 0.98], [23.094, -21.10, 3.66, 1.22],
// Piscis Austrinus, Grus, Phoenix
//   [22.577, -29.37, 1.16, 0.09], [22.407, -27.03, 4.17, -0.11], [22.082, -46.58, 1.74, -0.07], [22.427, -46.53, 2.10, 1.60],
//   [0.263, -42.18, 2.40, 1.09],
// Pegasus
//   [21.442, 9.53, 2.39, 1.53], [23.038, 28.05, 2.42, 1.67], [23.048, 15.12, 2.49, -0.04], [0.132, 15.11, 2.83, -0.23],
//   [22.430, 30.13, 2.94, 0.86], [22.415, 10.50, 3.40, -0.09], [22.102, 6.12, 3.53, 0.08], [22.500, 24.36, 3.48, 0.93],
//   [22.465, 23.34, 3.95, 1.07], [22.070, 25.21, 3.76, 0.44],
// Andromeda, Triangulum, Aries
//   [0.084, 29.05, 2.06, -0.11], [1.097, 35.37, 2.06, 1.58], [2.039, 42.20, 2.26, 1.37], [0.393, 30.52, 3.27, 1.28],
//   [23.019, 42.20, 3.62, -0.09], [0.568, 38.30, 3.87, 0.13], [0.473, 24.16, 4.06, 1.12], [23.376, 46.27, 3.82, 1.08],
//   [1.380, 48.38, 3.57, 1.28], [2.095, 34.59, 3.00, 0.14], [1.531, 29.35, 3.41, 0.49], [2.173, 33.51, 4.01, 0.02],
//   [2.072, 23.28, 2.00, 1.15], [1.546, 20.48, 2.64, 0.13], [1.535, 19.18, 3.88, -0.05],
// Perseus
//   [3.243, 49.52, 1.79, 0.48], [3.082, 40.57, 2.12, -0.05], [3.541, 31.53, 2.85, 0.12], [3.579, 40.01, 2.89, -0.18],
//   [3.048, 53.30, 2.93, 0.70], [3.429, 47.47, 3.01, -0.13], [3.052, 38.50, 3.39, 1.65], [2.507, 55.54, 3.76, 1.68],
//   [3.452, 42.35, 3.77, 0.42], [3.095, 44.51, 3.80, 0.98], [3.443, 32.17, 3.83, 0.05], [3.590, 35.47, 4.04, -0.01],
// Auriga + Elnath
//   [5.167, 46.00, 0.08, 0.80], [5.595, 44.57, 1.90, 0.03], [5.597, 37.13, 2.62, -0.08], [4.570, 33.10, 2.69, 1.53],
//   [5.020, 43.49, 3.03, 0.54], [5.065, 41.14, 3.17, -0.18], [5.025, 41.05, 3.75, 1.22], [5.263, 28.36, 1.65, -0.13],
// Taurus
//   [4.359, 16.31, 0.87, 1.54], [3.475, 24.06, 2.87, -0.09], [5.376, 21.09, 3.00, -0.19], [4.287, 15.52, 3.40, 0.18],
//   [4.007, 12.29, 3.41, -0.12], [4.286, 19.11, 3.53, 1.01], [4.198, 15.38, 3.65, 0.99], [4.229, 17.33, 3.76, 0.98],
//   [3.492, 24.03, 3.62, -0.08], [3.449, 24.07, 3.70, -0.11], [3.458, 24.22, 3.87, -0.07], [3.463, 23.57, 4.18, -0.06],
//   [3.452, 24.28, 4.30, -0.11], [3.248, 9.02, 3.60, 0.89], [3.272, 9.44, 3.74, -0.09],
// Orion
//   [5.145, -8.12, 0.13, -0.03], [5.552, 7.24, 0.50, 1.85], [5.251, 6.21, 1.64, -0.22], [5.362, -1.12, 1.69, -0.18],
//   [5.408, -1.57, 1.77, -0.21], [5.478, -9.40, 2.07, -0.17], [5.320, -0.18, 2.23, -0.22], [5.354, -5.55, 2.77, -0.24],
//   [4.498, 6.58, 3.19, 0.45], [5.245, -2.24, 3.35, -0.17], [5.351, 9.56, 3.39, -0.18], [5.176, -6.51, 3.60, -0.11],
//   [4.512, 5.36, 3.68, -0.17], [5.387, -2.36, 3.80, -0.24],
// Canis Major, Canis Minor
//   [6.451, -16.43, -1.46, 0.00], [6.586, -28.58, 1.50, -0.21], [7.084, -26.24, 1.84, 0.68], [6.227, -17.57, 1.98, -0.24],
//   [7.241, -29.18, 2.45, -0.08], [6.203, -30.04, 3.02, -0.19], [7.030, -23.50, 3.02, -0.08], [7.017, -27.56, 3.47, 1.73],
//   [6.498, -32.30, 3.96, -0.23], [7.393, 5.14, 0.34, 0.42], [7.272, 8.17, 2.90, -0.09],
// Gemini, Cancer
//   [7.453, 28.02, 1.14, 1.00], [7.346, 31.53, 1.58, 0.03], [6.377, 16.24, 1.93, 0.00], [6.230, 22.31, 2.88, 1.64],
//   [6.439, 25.08, 2.98, 1.40], [7.201, 21.59, 3.53, 0.34], [6.149, 22.30, 3.28, 1.60], [6.453, 12.54, 3.36, 0.43],
//   [7.444, 24.24, 3.57, 0.93], [7.181, 16.32, 3.58, 0.11], [6.528, 33.58, 3.60, 0.10], [7.041, 20.34, 3.90, 0.79],
//   [7.257, 27.48, 3.79, 1.03], [7.359, 26.54, 4.06, 1.54], [8.165, 9.11, 3.52, 1.48], [8.447, 18.09, 3.94, 1.08],
//   [8.467, 28.46, 4.02, 1.01], [8.433, 21.28, 4.66, 0.02], [8.585, 11.51, 4.26, 0.14],
// Leo
//   [10.084, 11.58, 1.35, -0.11], [11.491, 14.34, 2.14, 0.09], [10.200, 19.51, 2.01, 1.13], [11.141, 20.31, 2.56, 0.12],
//   [9.459, 23.46, 2.98, 0.80], [11.142, 15.26, 3.33, -0.01], [10.167, 23.25, 3.44, 0.31], [10.073, 16.46, 3.52, -0.03],
//   [9.528, 26.00, 3.88, 1.22], [9.411, 9.54, 3.52, 0.49], [11.239, 10.32, 3.94, 0.41], [10.328, 9.18, 3.85, -0.14],
// Virgo, Libra, Corvus, Crater
//   [13.252, -11.10, 0.98, -0.23], [12.417, -1.27, 2.74, 0.36], [13.022, 10.58, 2.83, 0.93], [11.507, 1.46, 3.61, 0.55],
//   [12.556, 3.24, 3.38, 1.58], [13.347, -0.36, 3.37, 0.11], [12.199, -0.40, 3.89, 0.02], [14.431, -5.39, 3.88, 0.38],
//   [14.463, 1.54, 3.72, -0.01], [14.160, -6.00, 4.08, 0.52], [15.170, -9.23, 2.61, -0.07], [14.509, -16.02, 2.75, 0.15],
//   [15.041, -25.17, 3.29, 1.70], [15.355, -14.47, 3.91, 1.01], [15.370, -28.08, 3.58, 1.57], [15.387, -29.47, 3.66, -0.17],
//   [12.158, -17.33, 2.59, -0.11], [12.344, -23.24, 2.65, 0.89], [12.299, -16.31, 2.95, -0.05], [12.101, -22.37, 3.00, 1.33],
//   [12.084, -24.44, 4.02, 0.32], [11.193, -14.47, 3.56, 1.12], [10.598, -18.18, 4.08, 1.09], [11.249, -17.41, 4.08, 0.21],
// Hydra
//   [9.276, -8.40, 1.98, 1.44], [13.189, -23.10, 3.00, 0.92], [8.554, 5.57, 3.11, 1.00], [10.496, -16.12, 3.11, 1.25],
//   [14.064, -26.41, 3.27, 1.12], [8.468, 6.25, 3.38, 0.68], [11.330, -31.51, 3.54, 0.95], [10.106, -12.21, 3.61, 1.01],
//   [10.261, -16.50, 3.81, 1.48], [9.144, 2.19, 3.88, -0.06], [9.399, -1.09, 3.91, 1.32], [8.377, 5.42, 4.16, 0.00],
// Centaurus, Lupus (the parts that rise at 39 N)
//   [14.067, -36.22, 2.06, 1.01], [13.206, -36.43, 2.75, 0.04], [14.355, -42.09, 2.35, -0.19], [14.592, -42.06, 3.13, -0.21],
//   [14.419, -47.23, 2.30, -0.20], [14.585, -43.08, 2.68, -0.22], [15.351, -41.10, 2.78, -0.20], [15.214, -40.39, 3.22, -0.22],
//   [15.227, -44.41, 3.37, -0.18], [16.001, -38.24, 3.41, -0.22],
// Coma, Canes Venatici, Lynx, Leo Minor, Camelopardalis, Lacerta
//   [13.119, 27.53, 4.26, 0.57], [13.100, 17.32, 4.32, 0.45], [12.270, 28.16, 4.36, 1.13], [12.560, 38.19, 2.90, -0.12],
//   [12.337, 41.21, 4.26, 0.59], [9.211, 34.24, 3.14, 1.55], [9.188, 36.48, 3.82, 0.06], [10.533, 34.13, 3.83, 1.04],
//   [5.034, 60.27, 4.03, 0.92], [4.541, 66.21, 4.29, 0.03], [22.313, 50.17, 3.77, 0.01],
// Monoceros, Lepus, Columba
//   [6.288, -7.02, 3.74, -0.17], [7.412, -9.33, 3.93, 1.02], [6.149, -6.16, 3.98, 1.32], [5.327, -17.49, 2.58, 0.21],
//   [5.282, -20.46, 2.84, 0.82], [5.055, -22.22, 3.19, 1.46], [5.129, -16.12, 3.31, -0.11], [5.469, -14.49, 3.55, 0.10],
//   [5.445, -22.27, 3.60, 0.47], [5.564, -14.10, 3.71, 0.33], [5.513, -20.53, 3.81, 0.99], [5.396, -34.04, 2.65, -0.12],
//   [5.510, -35.46, 3.12, 1.16],
// Eridanus
//   [5.079, -5.05, 2.79, 0.13], [3.580, -13.30, 2.95, 1.59], [3.432, -9.46, 3.54, 0.92], [3.329, -9.27, 3.73, 0.88],
//   [4.363, -33.48, 3.56, 1.00], [3.195, -21.45, 3.69, 1.62], [4.356, -30.34, 3.82, 0.98], [4.363, -3.21, 3.93, -0.21],
//   [4.455, -3.15, 4.00, -0.15], [2.583, -40.18, 2.90, 0.14], [2.564, -8.54, 3.89, 1.11],
// Cetus, Pisces
//   [0.436, -17.59, 2.04, 1.02], [3.023, 4.05, 2.54, 1.64], [1.086, -10.11, 3.46, 1.16], [2.433, 3.14, 3.47, 0.09],
//   [1.441, -15.56, 3.50, 0.72], [0.194, -8.49, 3.56, 1.22], [1.240, -8.11, 3.60, 1.06], [1.515, -10.20, 3.73, 1.14],
//   [2.000, -21.05, 4.00, 1.57], [2.395, 0.20, 4.07, -0.22], [1.315, 15.21, 3.62, 0.97], [23.172, 3.17, 3.69, 0.92],
//   [23.593, 6.52, 4.03, 0.42], [2.020, 2.46, 3.82, 0.03], [23.400, 5.38, 4.13, 0.51], [1.454, 9.09, 4.26, 0.96],
//   [1.029, 7.53, 4.28, 0.96],
// Puppis, Vela (low in the south)
//   [8.036, -40.00, 2.21, -0.27], [7.171, -37.06, 2.70, 1.62], [8.075, -24.18, 2.81, 0.43], [6.378, -43.12, 3.17, -0.11],
//   [7.493, -24.52, 3.34, 1.24], [8.095, -47.20, 1.83, -0.22], [9.080, -43.26, 2.21, 1.66],
//
// STAR_DATA packs each star into 8 base64url characters (48 bits, most significant first): RA in
// tenths of a minute of time (14 bits), Dec in arcminutes + 5400 (14), (V + 1.5) x 100 (10),
// (B-V + 0.3) x 100 (8), 2 spare: the table's own precision, a quarter of its size as code.
const STAR_DATA = 'Z7Y5FSYkZ2ok9gxwb4oa5iiIcuonZ4SYePIjZRxwfZ4fheSAgU4KdUAsaKX4Zw5AYT3tJx70agXNp8qoVEIFp0DEWYYTV00wYG3yd7yET741N5nMVPICV_h4blYEuCZQF7qgRXFoiy5nlZrEj95e5wiMpGqWOSiAnTKFKO3ck4Z1SQyImL5tmhUMBlYlhdpMAXIvVekACN41NjQ8DWozZoisEeJAR5w8x8o8NizQyV5aJ2Qg3cZ0p14Uz_Yrx5bs1gZJx9ocwpY5Z7Xo0tIsmLVoqDoSldbYpCIVprYAtBpPRyYIoMJH90xImcI4Np3kkIYup35Ig_JC6Axkp74myDZQrApiR-08uapZCFXcbApViFsAdb5XOGREroXi8mR4sJXOp9h4sfXMF2hkr8HeiSjEsUXb6RMYr63mSaTAwfn7VEycvvnoddWEwrnQ5joUuSn6xtRstu26Zyo8xuXC51oExaX2SCsMxzHgOCkUtsYTiESwtM4ZqEn4uu3VGG4QxHHr6ICAuhFyw4zQuV15VprYusVpiCXQsvmFhwR8th1dN5j4sxk_N7hUvUVOd2RculVVSGXcshGKCKIou1Gal8bsuYmXCFKsuGWVGS2wuImTGS4cwWGISAUowbGNODxgws2N-QYYwk2KCUT4wLF76KREtp2uCUrQx1llOHlMmrmiFq3wnHXIBr18obnbl0q4nLXjd8non23FiHh0oamHd5a4obmup0CYpqW5d7GkqGm_OCHwqe29aFRsqC3dOGKUpY3-CEgwmW2ZWDTkmRX_OGw8rHWjKFpQkg21tdRwkPm-qBDok020KFhskcXHKNBElGGzSZW4laG2WNZkhbWZckZkikm3Bg38gm2WholgiEXhJxTEjO3o99H8jw3Od8X0iDnDZ_KAia2FCECMkHXduRVgk41ppnZMlGFEp-BolJFiWCS0k9mLWBSQkhF5CEjglXWMSF04lD2ViL8ArBVGp2XwpUEXx-DgsYlhSMC8oqEhWRyIpNWApZS0oQEWliSQm9Ep5lCAmD1Dpp7wpi1ipq5InwV0t1ZEmN0_52X8otDzx3AsqJks55IEqeV1aCSopt1bqDSImtVY-FB8mpjuZANUpKDGZOAgpTSwRUEYlgz8texIndjQ5e5EpgS_JhQgltkHRnBcpDDFppAgm5zntsAUldTvltwsmVDxhtysptC7BxVEnhzC1wgopyzGl1ZMoUivZ40cnoiyqAKclYTj-GQorIjQlTxssWTu5YxEsojhdmiYrAjhppKgrSDyNr4YqajfdwYIs6kCtt0Er-TsV0xMszTpx4pUscUCZ9ZQqukCmGDUq4DHpzbost0ACDoMtYUOmHzQusS0iM4oteC5OIxQtaiqyJxQrkEymF6MsCE_uPIwzDkVBtTsvskaFym0vlUid-3wyyUTCBT4yQz9eDIIxc0Q6LR0w5jsmMsIwrTyyNEkydE8puHEzylQVvYA1s0WN3SM0sFReA0Q1nk1GDMIwvUt6EB40aVMWFhk08lRGKBU0OE0WNoA2RkCKBJg10TidCic1JzsGNxMz4ihZRBc1OyhtaL4BByy5hosy8l2lhbc2Dm61iMU2GGKhjxoAhGKdsQc1PnC1vHQ1L16J6hUz9lox9yY1hGtx8ns1YWp6IYkz1mwmDkoAVG-lZBMCuXXFZLwE13wReKcBiXFR3Z41-3wSABUCOHh6GSsB2WsiLI43YH_uFIoD1IH5-54FD3UtwiwEa3Ad608FXXQeJyAE-GphXpEEemfhnisEb2Z6GhkH-4MhSU4HWnrFahkJJXJFsyoJS3nltwwHOIaJu2QItYEtwxEHPHjJ6cMGq4jKDsYIzHxOD0gHZ35uEoAIw3KmFSMJVnXuKh0MX3-Anm4OC36FVCEODXdFnBYLmnN5o7cLzH11xVQL-XsJ0wwL0XrmDZgMv28xOxEKx2Pc7bgI42r5tRUNMGg1wgsKf2NB6jAJZ2AV6xIKfmZd94MKJmMKA4EKRWTWDoAI9GruABYIyWr-CBMI0ms6GRcI12rWOBgIzGtSRBMIAFzZ_ncIGF2CDBUMSUywoxsN4FtQyNcMs1pVOggNIlNBPwwNUFKNRwkNlktRZQ0M-FQZdQgNGk7VqwYLUlrp1UsMrVIh5Q0NF12x6QwMaE31_hMLYFmiBg0NO1HyEgYP00S0BB4QWjk5LAkQvDuhTmIO80ONXAYRWTjpixYO2zgxxAsQhj4JxBYQeTox8csQAjXqIgcR8VlIuEgReFwluBUSLW6pCIIRwnJFNCEPiWPBVx4O9ml9tsIPx2vxwKoRMWj990AOpWl53r4P1WB55kkSJGtB-3sRHWPh_CkQIHQ5_igQkWeqHG0RaW5yEYURz22aLLgTZVz99rIUf2VmIIoUk29aKIMUcWiCaCAVCV9-QCwXxF-ZHRMbs2IJbCcYOGb9X48aVWedlioW42qpwG4aVmLZ4x0YF2pV7j0XuWQZ9hsXKGzCGpgWs12p9k8at15CIEcYuF0aFxAfdEno-AcdwVMFqEIejl6psXsbw1YJ_1UeTFeR6Lwf01PR5ykc51PCGyAif08WGkQin1YqCh0hcE7CLlIj0kuVmxcizUVZqS0jUTyt38gki0aGHYMkmjoB_Lskqzh2BA0cvkPtmRMdeD5xn3cdS0TlvRkchT8twqMcdD0yKD4aiUaF-o4ZxkM6LosawUPOLjMWLExBXK4fNT6pwnoU6ln1zYIZYEUxzZshEDtd3Y4UlFpl6GIbEjaF-H0X2kjN_4MYdUSaE7IVqFaOGhgWp1NOHaIUOVm6Nh4hEzJJZIMfRjH1qSIiMyzdgQsjICzpzwkicyf1fAojGSvxoggkhy3JrAoj_i5F2AgkCyp95wwlgTBh6wge726GQFce3GTSRksdLm7iSo8eUHhNuBIdcXsmQFkV63Sh0LkV1HbiFCQZhXR2FYYL2o0OKXoLfZKWQyE0yYOGDx8PME3KDA0SBEtuH4QOpU6CJKIM_0OtmDMM0kDpsnAL7z9p1bAMOUUx4RMNjUZ9-SgNdT9V_k0N7EcaCT8NuUDOE4ENRDRxnxINtjLZzpIMB0-drSsJTEe5vb0IuEs5-HoIUUuGC3YKyzSx-oIHyz_-B8AKxDe6FIAKy1E-HwkLJ1FWJg8G9y6ZuCwG5EwKG40BtEOFYoQHH1g1lMICrkrV8JIGYVdp8ScEEUVx9GYAwkwd-pgDSEy1_ogEW0qyC5AEsECeJrsGO1SyLQgDk2LGAH82lFd2B3o4OVrSKUgExFb6FCE3eFmqM1EEHlz2QH4CdVvGQn4S5C7hcwMREzGZpMATCz2Zr0kPiivh0xMSVT0R5JoTHygBTQgVaCupc8Q';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const STAR_CATALOG_LIMIT_V = 3.9;

const RAD = Math.PI / 180;

/**
 * Celestial unit vectors (equatorial, of date), V and B-V of the catalogue, precessed from J2000 to
 * `year` with the rigorous IAU 1976 rotation (Meeus 21.3-21.4).
 */
export function starCatalog(year = 2026.5) {
  const T = (year - 2000) / 100;
  const as = RAD / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * as;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * as;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * as;
  const out = [];
  for (let k = 0; k < STAR_DATA.length; k += 8) {
    let n = 0;
    for (let i = 0; i < 8; i++) n = n * 64 + B64.indexOf(STAR_DATA[k + i]);
    const a0 = Math.floor(n / 2 ** 34) / 40 * RAD;                       // RA: tenths of a minute -> deg
    const d0 = (Math.floor(n / 2 ** 20) % 16384 - 5400) / 60 * RAD;
    const V = Math.floor(n / 1024) % 1024 / 100 - 1.5, bv = Math.floor(n / 4) % 256 / 100 - 0.3;
    const A = Math.cos(d0) * Math.sin(a0 + zeta);
    const B = Math.cos(theta) * Math.cos(d0) * Math.cos(a0 + zeta) - Math.sin(theta) * Math.sin(d0);
    const C = Math.sin(theta) * Math.cos(d0) * Math.cos(a0 + zeta) + Math.cos(theta) * Math.sin(d0);
    const a = Math.atan2(A, B) + z, d = Math.asin(Math.max(-1, Math.min(1, C)));
    out.push({ x: Math.cos(d) * Math.cos(a), y: Math.cos(d) * Math.sin(a), z: Math.sin(d), V, bv });
  }
  return out;
}

// Cell grid on the equi-angular cube (the same mapping as the atmosphere's procedural stars):
// STAR_CATALOG_CELLS per face edge; each cell lists up to 4 stars (catalogue index + 1, 0 = none),
// every star is listed in each cell its image (5 PSF sigmas, <= 0.3 deg) can reach.
export const STAR_CATALOG_CELLS = 64;
function cubeCell(x, y, z, n) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face, u, v;
  if (ax >= ay && ax >= az) { face = x > 0 ? 0 : 1; u = y / ax; v = z / ax; }
  else if (ay >= az) { face = y > 0 ? 2 : 3; u = x / ay; v = z / ay; }
  else { face = z > 0 ? 4 : 5; u = x / az; v = y / az; }
  u = Math.atan(u) * 4 / Math.PI; v = Math.atan(v) * 4 / Math.PI;
  return [face, Math.min(n - 1, Math.floor((u * 0.5 + 0.5) * n)), Math.min(n - 1, Math.floor((v * 0.5 + 0.5) * n))];
}
export function buildStarTextures(year) {
  const cat = starCatalog(year);
  const n = STAR_CATALOG_CELLS;
  const cells = new Float32Array(6 * n * n * 4);
  const count = new Uint8Array(6 * n * n);
  const order = cat.map((s, i) => i).sort((i, j) => cat[i].V - cat[j].V);   // brightest first
  const reach = 0.3 * RAD;
  for (const i of order) {
    const s = cat[i];
    // a star near a cell edge is listed in the neighbouring cells too: probe a small ring around it
    const seen = new Set();
    const ex = Math.abs(s.z) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let t1 = [s.y * ex[2] - s.z * ex[1], s.z * ex[0] - s.x * ex[2], s.x * ex[1] - s.y * ex[0]];
    const l1 = Math.hypot(...t1); t1 = t1.map((c) => c / l1);
    const t2 = [s.y * t1[2] - s.z * t1[1], s.z * t1[0] - s.x * t1[2], s.x * t1[1] - s.y * t1[0]];
    for (let k = -1; k < 8; k++) {
      const a = k < 0 ? 0 : k * Math.PI / 4, r = k < 0 ? 0 : reach;
      const p = [0, 1, 2].map((c) => [s.x, s.y, s.z][c] + r * (Math.cos(a) * t1[c] + Math.sin(a) * t2[c]));
      const [face, cu, cv] = cubeCell(p[0], p[1], p[2], n);
      const key = (face * n + cv) * n + cu;
      if (seen.has(key)) continue;
      seen.add(key);
      if (count[key] >= 4) continue;
      // texel layout: x = face * n + cu, y = cv
      const texel = cv * (6 * n) + face * n + cu;
      cells[texel * 4 + count[key]] = i + 1;
      count[key]++;
    }
  }
  const cellTex = new THREE.DataTexture(cells, 6 * n, n, THREE.RGBAFormat, THREE.FloatType);
  cellTex.minFilter = cellTex.magFilter = THREE.NearestFilter;
  cellTex.needsUpdate = true;
  cellTex.name = 'Sky.StarCells';
  // star data: row 0 = unit vector + V, row 1 = B-V
  const data = new Float32Array(cat.length * 2 * 4);
  cat.forEach((s, i) => {
    data.set([s.x, s.y, s.z, s.V], i * 4);
    data.set([s.bv, 0, 0, 0], (cat.length + i) * 4);
  });
  const dataTex = new THREE.DataTexture(data, cat.length, 2, THREE.RGBAFormat, THREE.FloatType);
  dataTex.minFilter = dataTex.magFilter = THREE.NearestFilter;
  dataTex.needsUpdate = true;
  dataTex.name = 'Sky.StarData';
  return { cellTex, dataTex, count: cat.length };
}

// ------------------------------------------------------------------ Milky Way panorama
export const MW_W = 2048, MW_H = 1024;
// u = l / 2pi + 0.5 (l in (-pi, pi], l = 0 the galactic centre), v = b / pi + 0.5
export const MILKY_WAY_FS = /* glsl */`
varying vec2 vUv;
${HASH_GLSL}
float mwHash(vec3 c, uint salt) { return atmRand3(uvec3(ivec3(c) + 4096) + uvec3(salt)).x; }
// value noise on the sphere (3D): no seams at l = 180 deg or at the poles
float mwNoise(vec3 p, uint salt) {
	vec3 i = floor(p), f = p - i;
	vec3 u = f * f * (3.0 - 2.0 * f);
	float n000 = mwHash(i, salt), n100 = mwHash(i + vec3(1, 0, 0), salt), n010 = mwHash(i + vec3(0, 1, 0), salt), n110 = mwHash(i + vec3(1, 1, 0), salt);
	float n001 = mwHash(i + vec3(0, 0, 1), salt), n101 = mwHash(i + vec3(1, 0, 1), salt), n011 = mwHash(i + vec3(0, 1, 1), salt), n111 = mwHash(i + vec3(1, 1, 1), salt);
	return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
// ridged fbm, 6 octaves from ~16 deg down to ~0.5 deg
float mwRidged(vec3 d, float base, uint salt) {
	float s = 0.0, a = 0.5, n = 0.0;
	vec3 p = d * base;
	for (int o = 0; o < 6; o++) {
		float r = 1.0 - abs(mwNoise(p, salt + uint(o) * 97u) * 2.0 - 1.0);
		s += a * r * r; n += a; p *= 2.03; a *= 0.55;
	}
	return s / n;
}
float mwFbm(vec3 d, float base, uint salt) {
	float s = 0.0, a = 0.5, n = 0.0;
	vec3 p = d * base;
	for (int o = 0; o < 5; o++) { s += a * mwNoise(p, salt + uint(o) * 131u); n += a; p *= 2.07; a *= 0.5; }
	return s / n;
}
float gauss2(float l, float b, float l0, float b0, float rl, float rb) { float x = (l - l0) / rl, y = (b - b0) / rb; return exp(-(x * x + y * y)); }
void main() {
	float lDeg = (vUv.x - 0.5) * 360.0, bDeg = (vUv.y - 0.5) * 180.0;
	float l = radians(lDeg), b = radians(bDeg);
	vec3 d = vec3(cos(b) * cos(l), cos(b) * sin(l), sin(b));
	float al = abs(lDeg);
	// disk: longitude profile and scale height
	float lp = al < 30.0 ? mix(1.0, 0.55, al / 30.0) : (al < 80.0 ? mix(0.55, 0.45, (al - 30.0) / 50.0) : (al < 120.0 ? mix(0.45, 0.2, (al - 80.0) / 40.0) : 0.2));
	float h = 4.5 + 2.5 * (1.0 - cos(l));
	float I = lp * exp(-abs(bDeg) / h);
	I += 1.6 * gauss2(lDeg, bDeg, 0.0, -1.0, 12.0, 8.0);                       // bulge
	I += 0.8 * gauss2(lDeg, bDeg, 2.0, -7.0, 5.0, 5.0);                         // Large Sagittarius star cloud
	I += 0.7 * gauss2(lDeg, bDeg, 27.0, -3.0, 3.0, 3.0);                        // Scutum star cloud
	I += 0.5 * gauss2(lDeg, bDeg, 78.0, 2.0, 6.0, 6.0);                         // Cygnus star cloud
	I += 0.25 * gauss2(lDeg, bDeg, -8.0, -4.0, 3.0, 2.5);                       // Small Sagittarius cloud (M24 region)
	// star-cloud mottling
	I *= 0.7 + 0.6 * mwRidged(d, 4.0, 11u);
	// dust
	vec3 w = vec3(mwFbm(d, 6.0, 31u), mwFbm(d, 6.0, 37u), mwFbm(d, 6.0, 41u)) - 0.5;
	vec3 dw = normalize(d + w * 0.06);
	float bw = degrees(asin(clamp(dw.z, -1.0, 1.0)));
	float lw = degrees(atan(dw.y, dw.x));
	float tau = 1.6 * mwRidged(dw, 9.0, 53u) * exp(-pow((bw - 0.5) / 3.0, 2.0));
	// Great Rift: Cygnus (l ~ 80) to Sagittarius (l ~ 10), just north of the plane, branched
	float rift = smoothstep(4.0, 12.0, lw) * (1.0 - smoothstep(75.0, 88.0, lw));
	float rc = 2.0 + 0.8 * sin(radians(lw) * 5.0);
	float branch1 = exp(-pow((bw - rc) / (1.6 + 0.8 * mwFbm(d, 12.0, 61u)), 2.0));
	float branch2 = exp(-pow((bw - rc + 3.2 + 1.5 * (mwFbm(d, 5.0, 67u) - 0.5)) / 1.2, 2.0)) * smoothstep(20.0, 30.0, lw) * (1.0 - smoothstep(45.0, 60.0, lw));
	float branch3 = exp(-pow((bw - rc - 2.6) / 1.0, 2.0)) * smoothstep(40.0, 50.0, lw) * (1.0 - smoothstep(70.0, 80.0, lw));
	tau += rift * 1.2 * max(branch1, 0.8 * max(branch2, branch3)) * (0.6 + 0.8 * mwFbm(d, 18.0, 71u));
	// Ophiuchus / Pipe dark clouds
	tau += 0.8 * smoothstep(-2.0, 2.0, lw) * (1.0 - smoothstep(8.0, 12.0, lw)) * smoothstep(3.0, 6.0, bw) * (1.0 - smoothstep(16.0, 20.0, bw)) * mwRidged(dw, 14.0, 79u) * 1.5;
	tau += 0.6 * gauss2(lw, bw, -3.0, 5.0, 4.0, 1.5) * (0.5 + mwFbm(d, 20.0, 83u));   // Pipe nebula
	I *= exp(-tau);
	gl_FragColor = vec4(I, 0.0, 0.0, 1.0);
}
`;
