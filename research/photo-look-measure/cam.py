import numpy as np
W,Hh=760,506; xc,yc=W/2,Hh/2
YHOR=208.25   # visible sea horizon at image centre column (continuous coords)
RE=6371e3/(1-0.13)  # effective Earth radius with standard refraction
# turbines: name, x (tower centre, continuous), y_waterline, y_hub (continuous)
T=[('hero',357.5,350.0,174.0),('T580',581.2,261.8,192.0),('T97',97.5,250.8,193.0),('T634',634.4,240.0,195.0),
   ('T306',306.6,235.0,197.0),('T659',660.0,230.0,195.5),('T46',47.5,231.5,197.0),('T409',410.0,227.6,199.8)]
def depression(x,y,f,th):
    r=(x-xc)/f; u=-(y-yc)/f
    vx=r; vy=u*np.cos(th)-np.sin(th); vz=-u*np.sin(th)-np.cos(th)
    return np.arctan2(-vy,np.hypot(vx,vz)), np.arctan2(vx,-vz)
def solve(f,h,turbs=T):
    dip=np.arccos(RE/(RE+h))
    th=dip+np.arctan((yc-YHOR)/f)
    out=[]
    for n,x,ywl,yhub in turbs:
        awl,phi=depression(x,ywl,f,th)
        D=h/np.tan(awl)
        for _ in range(5): D=(h+D*D/(2*RE))/np.tan(awl)
        ahub,_=depression(x,yhub,f,th)
        Hi=h+D*D/(2*RE)-D*np.tan(ahub)
        out.append((n,D,np.degrees(phi),Hi))
    return th,dip,out
ALL=[('T13',13.5,219.0),('T25',25.5,224.0),('T46',47.5,231.8),('T97',97.5,250.8),('T149',149.5,220.0),('T203',203.5,226.0),
     ('T235',235.5,218.0),('T300',300.5,222.0),('T306',306.6,235.0),('hero',357.5,350.0),('T366',366.5,220.0),('T409',410.0,227.8),
     ('T472',472.5,223.0),('T514',514.5,221.5),('T580',581.2,261.8),('T634',634.4,240.0),('T659',660.0,230.0),('T674',674.5,223.5),('T682',682.5,221.0)]
def ground(f,h,flat=True,yhor=YHOR):
    dip=0 if flat else np.arccos(RE/(RE+h))
    th=dip+np.arctan((yc-yhor)/f)
    res=[]
    for n,x,ywl in ALL:
        a,phi=depression(x,ywl,f,th)
        D=h/np.tan(a)
        res.append((n,D,phi,D*np.sin(phi),D*np.cos(phi)))
    return th,res
